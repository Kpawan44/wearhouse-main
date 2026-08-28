import { 
  Firestore, 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  getDocs 
} from 'firebase/firestore';
import { 
  Product, 
  Warehouse, 
  Stock, 
  StockMovement, 
  Transfer, 
  Inward, 
  Outward, 
  InventoryException, 
  ReconciliationReportSummary, 
  ReconciliationItemResult, 
  OrphanRecordResult, 
  ExceptionStatus 
} from '../types';

export interface RunReconciliationParams {
  db: Firestore;
  transfers?: Transfer[];
  inwards?: Inward[];
  outwards?: Outward[];
  movements?: StockMovement[];
  stocks?: Stock[];
  products?: Product[];
  warehouses?: Warehouse[];
  existingExceptions?: InventoryException[];
  currentUserName?: string;
}

/**
 * Pure non-destructive stock & transaction reconciliation engine.
 * Calculates expected quantities from immutable ledger history and compares against current stock.
 * Detects:
 *  1. Balanced/Healthy records (Difference = 0)
 *  2. Discrepancies (Expected != Current)
 *  3. Negative stock (Expected < 0, NEVER silently converts to 0)
 *  4. Orphan records (Preserves evidence, NEVER silently deletes)
 *  5. Upserts persistent idempotent exception records in Firestore
 */
export async function runInventoryReconciliation(
  paramOrDb: RunReconciliationParams | Firestore,
  options?: { currentUserName?: string; currentUserRole?: string }
): Promise<ReconciliationReportSummary> {
  let db: Firestore;
  let transfers: Transfer[] = [];
  let inwards: Inward[] = [];
  let outwards: Outward[] = [];
  let movements: StockMovement[] = [];
  let stocks: Stock[] = [];
  let products: Product[] = [];
  let warehouses: Warehouse[] = [];
  let existingExceptions: InventoryException[] = [];
  let currentUserName = 'System Auditor';

  if ('collection' in (paramOrDb as any) || !('transfers' in (paramOrDb as any))) {
    // Called with db as first argument
    db = paramOrDb as Firestore;
    if (options?.currentUserName) currentUserName = options.currentUserName;

    const [transfersSnap, inwardsSnap, outwardsSnap, movementsSnap, stocksSnap, productsSnap, warehousesSnap, exceptionsSnap] = await Promise.all([
      getDocs(collection(db, 'transfers')),
      getDocs(collection(db, 'inwards')),
      getDocs(collection(db, 'outwards')),
      getDocs(collection(db, 'movements')),
      getDocs(collection(db, 'stocks')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'warehouses')),
      getDocs(collection(db, 'inventoryExceptions'))
    ]);

    transfers = transfersSnap.docs.map(d => ({ id: d.id, ...d.data() as Transfer }));
    inwards = inwardsSnap.docs.map(d => ({ id: d.id, ...d.data() as Inward }));
    outwards = outwardsSnap.docs.map(d => ({ id: d.id, ...d.data() as Outward }));
    movements = movementsSnap.docs.map(d => ({ id: d.id, ...d.data() as StockMovement }));
    stocks = stocksSnap.docs.map(d => ({ id: d.id, ...d.data() as Stock }));
    products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() as Product }));
    warehouses = warehousesSnap.docs.map(d => ({ id: d.id, ...d.data() as Warehouse }));
    existingExceptions = exceptionsSnap.docs.map(d => ({ id: d.id, ...d.data() as InventoryException }));
  } else {
    const p = paramOrDb as RunReconciliationParams;
    db = p.db;
    transfers = p.transfers || [];
    inwards = p.inwards || [];
    outwards = p.outwards || [];
    movements = p.movements || [];
    stocks = p.stocks || [];
    products = p.products || [];
    warehouses = p.warehouses || [];
    existingExceptions = p.existingExceptions || [];
    if (p.currentUserName) currentUserName = p.currentUserName;
  }
  const now = new Date().toISOString();
  const validProductsMap = new Map(products.map(p => [p.itemCode, p]));
  const validWarehousesMap = new Map(warehouses.map(w => [w.code || w.id || '', w]));

  // Active document index for quick lookup
  const activeTransfersSet = new Set(transfers.map(t => t.transferNumber));
  const activeInwardsSet = new Set(inwards.map(i => i.grnNumber));
  const activeOutwardsSet = new Set(outwards.map(o => o.dispatchNumber));

  // 1. Detect Orphan Records (WITHOUT DELETING ANY EVIDENCE) & Accumulate Valid Ledger Quantities
  const orphanResults: OrphanRecordResult[] = [];
  const orphanExceptionsToUpsert: InventoryException[] = [];

  interface StockCalculationEntry {
    warehouseId: string;
    warehouseName: string;
    itemCode: string;
    itemName: string;
    availableQty: number;
    inTransitQty: number;
    damagedQty: number;
    reservedQty: number;
    relatedTxIds: Set<string>;
  }

  const stockMap = new Map<string, StockCalculationEntry>();
  const getKey = (whId: string, itemCode: string) => `${whId}:::${itemCode}`;

  // Initialize stockMap for all (Warehouse, Product) pairs in the catalog
  for (const wh of warehouses) {
    const whCode = wh.code || wh.id || '';
    if (!whCode) continue;
    for (const prod of products) {
      const key = getKey(whCode, prod.itemCode);
      stockMap.set(key, {
        warehouseId: whCode,
        warehouseName: wh.name,
        itemCode: prod.itemCode,
        itemName: prod.name,
        availableQty: 0,
        inTransitQty: 0,
        damagedQty: 0,
        reservedQty: 0,
        relatedTxIds: new Set<string>()
      });
    }
  }

  for (const mvt of movements) {
    let isOrphan = false;
    let reason = '';
    let referencedEntity = '';

    // Check product existence
    if (!validProductsMap.has(mvt.itemCode)) {
      isOrphan = true;
      referencedEntity = `Product: ${mvt.itemCode}`;
      reason = `Ledger movement references deleted or missing SKU (${mvt.itemCode}).`;
    }

    // Check warehouse existence
    if (!validWarehousesMap.has(mvt.warehouseId)) {
      isOrphan = true;
      referencedEntity = (referencedEntity ? `${referencedEntity}, ` : '') + `Warehouse: ${mvt.warehouseId}`;
      reason += ` Ledger movement references deleted or missing Warehouse (${mvt.warehouseId}).`;
    }

    // Check parent document integrity (skip for direct adjustments and reversal records)
    const isReversal = !!mvt.reversalOf || mvt.transactionType?.includes('Reversal') || mvt.referenceNumber?.startsWith('REV-');
    if (!isReversal) {
      if (mvt.transactionType === 'Transfer Out' || mvt.transactionType === 'Transfer In') {
        if (mvt.referenceNumber && !activeTransfersSet.has(mvt.referenceNumber)) {
          isOrphan = true;
          referencedEntity = (referencedEntity ? `${referencedEntity}, ` : '') + `Transfer: ${mvt.referenceNumber}`;
          reason += ` Parent transfer order (${mvt.referenceNumber}) not found in transfers collection.`;
        }
      } else if (mvt.transactionType === 'Inward (GRN)') {
        if (mvt.referenceNumber && !activeInwardsSet.has(mvt.referenceNumber)) {
          isOrphan = true;
          referencedEntity = (referencedEntity ? `${referencedEntity}, ` : '') + `GRN: ${mvt.referenceNumber}`;
          reason += ` Parent GRN document (${mvt.referenceNumber}) not found in inwards collection.`;
        }
      } else if (mvt.transactionType === 'Outward (Dispatch)') {
        if (mvt.referenceNumber && !activeOutwardsSet.has(mvt.referenceNumber)) {
          isOrphan = true;
          referencedEntity = (referencedEntity ? `${referencedEntity}, ` : '') + `Dispatch: ${mvt.referenceNumber}`;
          reason += ` Parent dispatch note (${mvt.referenceNumber}) not found in outwards collection.`;
        }
      }
    }

    if (isOrphan) {
      const recordId = mvt.id || `MVT-${mvt.referenceNumber}-${mvt.itemCode}`;
      
      // Look for existing unresolved exception for this orphan
      const existingOrphanExc = existingExceptions.find(e => 
        e.orphanDetails?.recordId === recordId && 
        (e.status === 'OPEN' || e.status === 'UNDER_REVIEW')
      );

      const exceptionId = existingOrphanExc?.id || `EXC_ORPHAN_${recordId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      orphanResults.push({
        recordId,
        collection: 'movements',
        referencedEntity: referencedEntity || mvt.referenceNumber || mvt.itemCode,
        detectedDate: now,
        possibleCause: reason.trim(),
        hasException: true,
        exceptionId
      });

      orphanExceptionsToUpsert.push({
        id: exceptionId,
        warehouseId: mvt.warehouseId || 'UNKNOWN',
        warehouseName: mvt.warehouseName || 'Unknown Warehouse',
        itemCode: mvt.itemCode || 'UNKNOWN',
        itemName: mvt.itemName || 'Unknown Item',
        expectedQty: 0,
        currentQty: mvt.qty || 0,
        difference: -(mvt.qty || 0),
        reason: `ORPHAN RECORD: ${reason.trim()}`,
        category: 'ORPHAN_RECORD',
        status: existingOrphanExc ? existingOrphanExc.status : 'OPEN',
        detectedAt: existingOrphanExc ? existingOrphanExc.detectedAt : now,
        detectedBy: existingOrphanExc ? existingOrphanExc.detectedBy : currentUserName,
        relatedTransactionIds: [mvt.referenceNumber || recordId],
        orphanDetails: {
          recordId,
          collection: 'movements',
          referencedEntity,
          possibleCause: reason.trim()
        },
        notes: existingOrphanExc?.notes || `Detected during system reconciliation audit on ${now.slice(0, 10)}.`
      });

      // CRITICAL: Exclude orphaned movements from contributing to the valid expected stock calculation!
      // The original movement is preserved in Firestore for forensic audit, but skipped here.
      continue;
    }

    // Accumulate only VALID (non-orphaned) movements into expected stockMap
    if (!mvt.warehouseId || !mvt.itemCode) continue;
    const key = getKey(mvt.warehouseId, mvt.itemCode);
    if (!stockMap.has(key)) {
      const prod = validProductsMap.get(mvt.itemCode);
      const wh = validWarehousesMap.get(mvt.warehouseId);
      stockMap.set(key, {
        warehouseId: mvt.warehouseId,
        warehouseName: wh ? wh.name : (mvt.warehouseName || mvt.warehouseId),
        itemCode: mvt.itemCode,
        itemName: prod ? prod.name : (mvt.itemName || mvt.itemCode),
        availableQty: 0,
        inTransitQty: 0,
        damagedQty: 0,
        reservedQty: 0,
        relatedTxIds: new Set<string>()
      });
    }

    const entry = stockMap.get(key)!;
    // Legitimate ledger delta (can be negative or positive)
    entry.availableQty += (Number(mvt.qty) || 0);

    if (mvt.transactionType?.includes('Damage') || mvt.adjustmentType === 'Damage') {
      entry.damagedQty += Math.abs(Number(mvt.qty) || 0);
    }
    if (mvt.referenceNumber) {
      entry.relatedTxIds.add(mvt.referenceNumber);
    }
  }

  // Factor in-transit quantities from active transfers
  for (const tr of transfers) {
    if (tr.status === 'Dispatched' || tr.status === 'In Transit') {
      const items = tr.items && tr.items.length > 0 
        ? tr.items 
        : [{ itemCode: tr.itemCode, itemName: tr.itemName, qty: tr.qty }];
      for (const item of items) {
        if (!item.itemCode || !tr.sourceWarehouseId) continue;
        const srcKey = getKey(tr.sourceWarehouseId, item.itemCode);
        if (!stockMap.has(srcKey)) {
          const prod = validProductsMap.get(item.itemCode);
          const wh = validWarehousesMap.get(tr.sourceWarehouseId);
          stockMap.set(srcKey, {
            warehouseId: tr.sourceWarehouseId,
            warehouseName: wh ? wh.name : (tr.sourceWarehouseName || tr.sourceWarehouseId),
            itemCode: item.itemCode,
            itemName: prod ? prod.name : (item.itemName || item.itemCode),
            availableQty: 0,
            inTransitQty: 0,
            damagedQty: 0,
            reservedQty: 0,
            relatedTxIds: new Set<string>()
          });
        }
        const entry = stockMap.get(srcKey)!;
        entry.inTransitQty += (Number(item.qty) || 0);
        if (tr.transferNumber) entry.relatedTxIds.add(tr.transferNumber);
      }
    }
  }

  // 3. Compare Expected Balances against Stored Balances (WITHOUT SILENTLY OVERWRITING)
  const storedStockMap = new Map<string, Stock>();
  for (const s of stocks) {
    if (!s.warehouseId || !s.itemCode) continue;
    storedStockMap.set(getKey(s.warehouseId, s.itemCode), s);
  }

  const itemResults: ReconciliationItemResult[] = [];
  const stockExceptionsToUpsert: InventoryException[] = [];

  let healthyCount = 0;
  let discrepancyCount = 0;
  let negativeStockCount = 0;

  // Process all keys in stockMap + any extra keys in storedStockMap
  const allKeys = new Set([...stockMap.keys(), ...storedStockMap.keys()]);

  for (const key of allKeys) {
    const computed = stockMap.get(key);
    const stored = storedStockMap.get(key);

    const [whId, itemCode] = key.split(':::');
    const wh = validWarehousesMap.get(whId);
    const prod = validProductsMap.get(itemCode);

    const warehouseName = wh ? wh.name : (stored?.warehouseName || computed?.warehouseName || whId);
    const itemName = prod ? prod.name : (stored?.itemName || computed?.itemName || itemCode);

    // CRITICAL: Do NOT silently convert negative calculated balance to 0! Preserve actual expectedQty.
    const expectedQty = computed ? computed.availableQty : 0;
    const currentQty = stored ? (stored.availableQty || 0) : 0;
    const difference = currentQty - expectedQty; // negative means stock is short, positive means excess stored

    let itemStatus: 'HEALTHY' | 'DISCREPANCY' | 'NEGATIVE_STOCK' = 'HEALTHY';
    let isDiscrepancy = false;
    let isNegative = false;

    if (expectedQty < 0) {
      // Negative expected stock integrity violation
      itemStatus = 'NEGATIVE_STOCK';
      isNegative = true;
      negativeStockCount++;
    } else if (difference !== 0) {
      // Mismatch between stored stock and expected ledger stock
      itemStatus = 'DISCREPANCY';
      isDiscrepancy = true;
      discrepancyCount++;
    } else {
      itemStatus = 'HEALTHY';
      healthyCount++;
    }

    // Look for existing unresolved exception for this (warehouseId, itemCode)
    const existingExc = existingExceptions.find(e => 
      e.warehouseId === whId && 
      e.itemCode === itemCode && 
      (e.status === 'OPEN' || e.status === 'UNDER_REVIEW') &&
      e.category !== 'ORPHAN_RECORD'
    );

    const deterministicId = existingExc?.id || `EXC_${whId}_${itemCode}`;

    if (isNegative || isDiscrepancy) {
      const category = isNegative ? 'NEGATIVE_STOCK' : 'DISCREPANCY';
      const reason = isNegative
        ? `STOCK INTEGRITY EXCEPTION: Expected stock is negative (${expectedQty}), stored stock is ${currentQty}. Difference: ${difference}.`
        : `INVENTORY DISCREPANCY: Expected stock from ledger is ${expectedQty}, but stored balance is ${currentQty}. Difference: ${difference > 0 ? '+' : ''}${difference}.`;

      const relatedTxIds = computed ? Array.from(computed.relatedTxIds) : [];

      stockExceptionsToUpsert.push({
        id: deterministicId,
        warehouseId: whId,
        warehouseName,
        productId: prod?.id,
        itemCode,
        itemName,
        expectedQty,
        currentQty,
        difference,
        reason,
        category,
        status: existingExc ? existingExc.status : 'OPEN',
        detectedAt: existingExc ? existingExc.detectedAt : now,
        detectedBy: existingExc ? existingExc.detectedBy : currentUserName,
        relatedTransactionIds: relatedTxIds,
        notes: existingExc?.notes || `Detected during reconciliation on ${now.slice(0, 10)}.`
      });

      itemResults.push({
        warehouseId: whId,
        warehouseName,
        itemCode,
        itemName,
        expectedQty,
        currentQty,
        difference,
        status: itemStatus,
        hasException: true,
        exceptionId: deterministicId,
        exceptionStatus: existingExc ? existingExc.status : 'OPEN'
      });
    } else {
      // Healthy record
      itemResults.push({
        warehouseId: whId,
        warehouseName,
        itemCode,
        itemName,
        expectedQty,
        currentQty,
        difference: 0,
        status: 'HEALTHY',
        hasException: !!existingExc,
        exceptionId: existingExc?.id,
        exceptionStatus: existingExc?.status
      });
    }
  }

  // 4. Persist / Upsert Exceptions to Firestore Idempotently
  const allExceptionsToUpsert = [...stockExceptionsToUpsert, ...orphanExceptionsToUpsert];

  for (const exc of allExceptionsToUpsert) {
    try {
      const excRef = doc(db, 'inventoryExceptions', exc.id!);
      await setDoc(excRef, {
        id: exc.id,
        warehouseId: exc.warehouseId,
        warehouseName: exc.warehouseName || '',
        productId: exc.productId || '',
        itemCode: exc.itemCode,
        itemName: exc.itemName || '',
        expectedQty: exc.expectedQty,
        currentQty: exc.currentQty,
        difference: exc.difference,
        reason: exc.reason,
        category: exc.category,
        status: exc.status,
        detectedAt: exc.detectedAt,
        detectedBy: exc.detectedBy,
        relatedTransactionIds: exc.relatedTransactionIds,
        notes: exc.notes || '',
        orphanDetails: exc.orphanDetails || null,
        updatedAt: now
      }, { merge: true });
    } catch (err) {
      console.warn(`Could not persist exception ${exc.id}:`, err);
    }
  }

  // Count open, under review, and resolved
  const allCurrentExceptions = [...existingExceptions];
  for (const exc of allExceptionsToUpsert) {
    const idx = allCurrentExceptions.findIndex(e => e.id === exc.id);
    if (idx >= 0) {
      allCurrentExceptions[idx] = { ...allCurrentExceptions[idx], ...exc };
    } else {
      allCurrentExceptions.push(exc);
    }
  }

  const openExceptionsCount = allCurrentExceptions.filter(e => e.status === 'OPEN').length;
  const underReviewCount = allCurrentExceptions.filter(e => e.status === 'UNDER_REVIEW').length;
  const resolvedCount = allCurrentExceptions.filter(e => e.status === 'RESOLVED').length;

  return {
    healthyCount,
    discrepancyCount,
    negativeStockCount,
    orphanCount: orphanResults.length,
    totalExceptions: allCurrentExceptions.length,
    openExceptionsCount,
    underReviewCount,
    resolvedCount,
    lastReconciledAt: now,
    reconciledBy: currentUserName || 'System Auditor',
    items: itemResults,
    orphans: orphanResults
  };
}

/**
 * Explicitly resolves an inventory exception with complete audit metadata.
 * Does NOT delete history or secretly manipulate transactions.
 */
export async function resolveInventoryException(
  dbOrParams: Firestore | {
    db: Firestore;
    exceptionId: string;
    resolvedBy: string;
    resolutionNote: string;
    resolutionTransactionId?: string;
  },
  exceptionId?: string,
  details?: {
    resolvedBy: string;
    resolutionNote: string;
    resolutionTransactionId?: string;
  }
): Promise<void> {
  let db: Firestore;
  let excId: string;
  let resolvedBy: string;
  let resolutionNote: string;
  let resolutionTransactionId: string | undefined;

  if ('collection' in (dbOrParams as any)) {
    db = dbOrParams as Firestore;
    excId = exceptionId!;
    resolvedBy = details?.resolvedBy || 'System Auditor';
    resolutionNote = details?.resolutionNote || 'Resolved via auditor exception workbench';
    resolutionTransactionId = details?.resolutionTransactionId;
  } else {
    const p = dbOrParams as {
      db: Firestore;
      exceptionId: string;
      resolvedBy: string;
      resolutionNote: string;
      resolutionTransactionId?: string;
    };
    db = p.db;
    excId = p.exceptionId;
    resolvedBy = p.resolvedBy;
    resolutionNote = p.resolutionNote;
    resolutionTransactionId = p.resolutionTransactionId;
  }

  const excRef = doc(db, 'inventoryExceptions', excId);
  await updateDoc(excRef, {
    status: 'RESOLVED',
    resolvedBy,
    resolvedAt: new Date().toISOString(),
    resolutionNote,
    resolutionTransactionId: resolutionTransactionId || '',
    updatedAt: new Date().toISOString()
  });
}

/**
 * Explicitly marks an exception as UNDER_REVIEW for active investigation.
 */
export async function markExceptionUnderReview(
  dbOrParams: Firestore | {
    db: Firestore;
    exceptionId: string;
    underReviewBy: string;
    notes?: string;
  },
  exceptionId?: string,
  underReviewBy?: string,
  notes?: string
): Promise<void> {
  let db: Firestore;
  let excId: string;
  let reviewer: string;
  let reviewNotes: string | undefined;

  if ('collection' in (dbOrParams as any)) {
    db = dbOrParams as Firestore;
    excId = exceptionId!;
    reviewer = underReviewBy || 'System Auditor';
    reviewNotes = notes;
  } else {
    const p = dbOrParams as {
      db: Firestore;
      exceptionId: string;
      underReviewBy: string;
      notes?: string;
    };
    db = p.db;
    excId = p.exceptionId;
    reviewer = p.underReviewBy;
    reviewNotes = p.notes;
  }

  const excRef = doc(db, 'inventoryExceptions', excId);
  await updateDoc(excRef, {
    status: 'UNDER_REVIEW',
    underReviewBy: reviewer,
    underReviewAt: new Date().toISOString(),
    notes: reviewNotes || 'Under active investigation by warehouse supervisor.',
    updatedAt: new Date().toISOString()
  });
}
