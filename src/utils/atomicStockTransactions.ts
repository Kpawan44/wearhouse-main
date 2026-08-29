/**
 * ATOMIC STOCK & TRANSFER TRANSACTIONS (CHANGE #7)
 * 
 * Guarantees ACID atomicity across all stock-changing business operations.
 * Every stock operation either:
 *   A) Completes ALL required Firestore writes successfully (Stock + Movement + Document + Status)
 *   OR
 *   B) Makes NO stock-changing writes at all (Zero partial states / Rollback on error).
 */

import {
  Firestore,
  doc,
  collection,
  runTransaction,
  serverTimestamp,
  DocumentReference,
  query,
  where,
  getDocs
} from 'firebase/firestore';
import { Inward, Outward, Transfer, StockMovement, Stock, Product, UserRole } from '../types';

/**
 * Standard deterministic stock document ID format.
 * Matches default system seeds (e.g., 'WH-DEL_PRD-S24').
 */
export function getStockDocId(warehouseId: string, itemCode: string): string {
  return `${warehouseId}_${itemCode}`;
}

/**
 * CHANGE #6: Stock Write Protection Guards
 * Ensures no stock-modifying transaction can be executed by unauthorized roles (e.g. Viewer).
 * Explicitly verifies authorization for inventory management operations.
 */
export function assertCanWriteStock(
  role: UserRole,
  actionName: string = 'modify inventory'
): void {
  if (role !== 'Super Admin' && role !== 'Store Operator') {
    throw new Error(
      `Access Denied: Role "${role}" is not authorized to ${actionName}. Authorized roles: Super Admin, Store Operator.`
    );
  }
}

export function assertSuperAdmin(
  role: UserRole,
  actionName: string = 'perform manual adjustments or overrides'
): void {
  if (role !== 'Super Admin') {
    throw new Error(
      `Access Denied: Role "${role}" is not authorized to ${actionName}. Only Super Admin is authorized.`
    );
  }
}

/**
 * Helper to compute updated stock values given a quantity delta and targeted field.
 * STRICT VALIDATION: Never clamps to zero. If any inventory bucket would drop below zero,
 * throws an explicit Error to abort the atomic transaction cleanly and trigger rollback.
 */
export function calculateUpdatedStock(
  existingStock: Stock | null,
  warehouseId: string,
  warehouseName: string,
  itemCode: string,
  itemName: string,
  barcode: string,
  field: 'availableQty' | 'reservedQty' | 'inTransitQty' | 'damagedQty',
  qtyDelta: number
): Stock {
  const currentAvailable = existingStock?.availableQty || 0;
  const currentReserved = existingStock?.reservedQty || 0;
  const currentInTransit = existingStock?.inTransitQty || 0;
  const currentDamaged = existingStock?.damagedQty || 0;

  let newAvailable = currentAvailable;
  let newReserved = currentReserved;
  let newInTransit = currentInTransit;
  let newDamaged = currentDamaged;

  if (field === 'availableQty') {
    newAvailable = currentAvailable + qtyDelta;
    if (newAvailable < 0) {
      throw new Error(
        `Insufficient available stock for SKU ${itemCode} in ${warehouseName || warehouseId}. Current available: ${currentAvailable}, requested reduction: ${Math.abs(qtyDelta)}.`
      );
    }
  } else if (field === 'reservedQty') {
    newReserved = currentReserved + qtyDelta;
    if (newReserved < 0) {
      throw new Error(
        `Insufficient reserved stock for SKU ${itemCode} in ${warehouseName || warehouseId}. Current reserved: ${currentReserved}, requested reduction: ${Math.abs(qtyDelta)}.`
      );
    }
  } else if (field === 'inTransitQty') {
    newInTransit = currentInTransit + qtyDelta;
    if (newInTransit < 0) {
      throw new Error(
        `Insufficient in-transit stock for SKU ${itemCode} in ${warehouseName || warehouseId}. Current in-transit: ${currentInTransit}, requested reduction: ${Math.abs(qtyDelta)}.`
      );
    }
  } else if (field === 'damagedQty') {
    newDamaged = currentDamaged + qtyDelta;
    if (newDamaged < 0) {
      throw new Error(
        `Insufficient damaged stock for SKU ${itemCode} in ${warehouseName || warehouseId}. Current damaged: ${currentDamaged}, requested reduction: ${Math.abs(qtyDelta)}.`
      );
    }
  }

  const newTotal = newAvailable + newReserved + newInTransit + newDamaged;

  return {
    id: existingStock?.id || getStockDocId(warehouseId, itemCode),
    warehouseId,
    warehouseName: existingStock?.warehouseName || warehouseName,
    itemCode,
    itemName: existingStock?.itemName || itemName,
    barcode: existingStock?.barcode || barcode,
    availableQty: newAvailable,
    reservedQty: newReserved,
    inTransitQty: newInTransit,
    damagedQty: newDamaged,
    totalQty: newTotal
  };
}

// ============================================================================
// 1. ATOMIC INWARD GRN POSTING
// Writes: Inward Doc + Stock Doc + Movement Ledger Doc
// ============================================================================
export async function postInwardAtomic(
  db: Firestore,
  inward: Omit<Inward, 'id'>,
  barcode: string,
  role: UserRole,
  user?: string
): Promise<{ inwardId: string; movementId: string; stockDocId: string }> {
  assertCanWriteStock(role, 'post Inward GRN documents');
  const inwardDocRef = doc(collection(db, 'inwards'));
  const stockDocId = getStockDocId(inward.warehouseId, inward.itemCode);
  const stockDocRef = doc(db, 'stocks', stockDocId);
  const movementDocRef = doc(collection(db, 'movements'));

  await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const stockSnap = await transaction.get(stockDocRef);
    const existingStock = stockSnap.exists() ? (stockSnap.data() as Stock) : null;

    // 2. IN-MEMORY COMPUTATION
    const updatedStock = calculateUpdatedStock(
      existingStock,
      inward.warehouseId,
      inward.warehouseName,
      inward.itemCode,
      inward.itemName,
      barcode,
      'availableQty',
      inward.qty
    );

    const now = new Date();
    const dateStr = inward.date || now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString();

    const movementData: Omit<StockMovement, 'id'> = {
      date: dateStr,
      time: timeStr,
      itemCode: inward.itemCode,
      itemName: inward.itemName,
      warehouseId: inward.warehouseId,
      warehouseName: inward.warehouseName,
      qty: inward.qty,
      transactionType: 'Inward (GRN)',
      referenceNumber: inward.grnNumber,
      user: user || `${role} Operator`,
      remarks: `Posted via supplier invoice ${inward.invoiceNumber}. Batch: ${inward.batchNumber}. ${inward.remarks || ''}`
    };

    // 3. ALL WRITES
    transaction.set(inwardDocRef, {
      ...inward,
      createdAt: (inward as any).createdAt || now.toISOString()
    });
    transaction.set(stockDocRef, updatedStock, { merge: true });
    transaction.set(movementDocRef, movementData);
  });

  return {
    inwardId: inwardDocRef.id,
    movementId: movementDocRef.id,
    stockDocId
  };
}

// ============================================================================
// 2. ATOMIC OUTWARD DISPATCH POSTING
// Writes: Outward Doc + Stock Doc + Movement Ledger Doc
// ============================================================================
export async function postOutwardAtomic(
  db: Firestore,
  outward: Omit<Outward, 'id'>,
  barcode: string,
  role: UserRole,
  user?: string
): Promise<{ outwardId: string; movementId: string; stockDocId: string }> {
  assertCanWriteStock(role, 'post Outward Customer Dispatches');
  const outwardDocRef = doc(collection(db, 'outwards'));
  const stockDocId = getStockDocId(outward.warehouseId, outward.itemCode);
  const stockDocRef = doc(db, 'stocks', stockDocId);
  const movementDocRef = doc(collection(db, 'movements'));

  await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const stockSnap = await transaction.get(stockDocRef);
    const existingStock = stockSnap.exists() ? (stockSnap.data() as Stock) : null;

    // 2. IN-MEMORY COMPUTATION & STOCK DECREMENT
    const updatedStock = calculateUpdatedStock(
      existingStock,
      outward.warehouseId,
      outward.warehouseName,
      outward.itemCode,
      outward.itemName,
      barcode,
      'availableQty',
      -outward.qty
    );

    const now = new Date();
    const dateStr = outward.date || now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString();

    const movementData: Omit<StockMovement, 'id'> = {
      date: dateStr,
      time: timeStr,
      itemCode: outward.itemCode,
      itemName: outward.itemName,
      warehouseId: outward.warehouseId,
      warehouseName: outward.warehouseName,
      qty: -outward.qty,
      transactionType: 'Outward (Dispatch)',
      referenceNumber: outward.dispatchNumber,
      user: user || `${role} Operator`,
      remarks: `Dispatched via vehicle ${outward.vehicleNumber}. Carrier: ${outward.transportName}.${outward.invoiceNumber && outward.invoiceNumber !== 'N/A' ? ` Invoice No: ${outward.invoiceNumber}.` : ''} ${outward.remarks || ''}`
    };

    // 3. ALL WRITES
    transaction.set(outwardDocRef, {
      ...outward,
      createdAt: (outward as any).createdAt || now.toISOString()
    });
    transaction.set(stockDocRef, updatedStock, { merge: true });
    transaction.set(movementDocRef, movementData);
  });

  return {
    outwardId: outwardDocRef.id,
    movementId: movementDocRef.id,
    stockDocId
  };
}

// ============================================================================
// 3. ATOMIC TRANSFER STATUS TRANSITION (Dispatched, Received, Approved, etc.)
// Writes: Transfer Doc + Source Stock Doc(s) + Dest Stock Doc(s) + Movement Doc(s)
// ============================================================================
export async function updateTransferStatusAtomic(
  db: Firestore,
  params: {
    id: string;
    nextStatus: Transfer['status'];
    user: string;
    currentRole: UserRole;
    remarks?: string;
    receiptDetails?: {
      items?: { itemCode: string; itemName: string; qty: number; receivedQty: number; shortQty: number; shortReason?: string }[];
      receivingRemarks?: string;
    };
    productBarcodes?: Record<string, string>;
  }
): Promise<{ success: boolean; oldStatus: string; nextStatus: string }> {
  const { id, nextStatus, user, currentRole, remarks, receiptDetails, productBarcodes = {} } = params;
  assertCanWriteStock(currentRole, 'update Transfer status');
  const transferDocRef = doc(db, 'transfers', id);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const transferSnap = await transaction.get(transferDocRef);
    if (!transferSnap.exists()) {
      throw new Error(`Transfer order ${id} not found in database.`);
    }

    const tr = transferSnap.data() as Transfer;
    const oldStatus = tr.status;

    if (oldStatus === nextStatus) {
      return { success: true, oldStatus, nextStatus };
    }

    if (nextStatus === 'Dispatched' && (oldStatus === 'Dispatched' || oldStatus === 'In Transit' || oldStatus === 'Received' || oldStatus === 'Closed')) {
      return { success: true, oldStatus, nextStatus };
    }

    if (nextStatus === 'Received' && (oldStatus === 'Received' || oldStatus === 'Closed')) {
      return { success: true, oldStatus, nextStatus };
    }

    const transferItems = tr.items && tr.items.length > 0
      ? tr.items
      : [{ itemCode: tr.itemCode, itemName: tr.itemName, qty: tr.qty }];

    // Prepare Document References for all items
    const sourceStockDocRefs: DocumentReference[] = [];
    const destStockDocRefs: DocumentReference[] = [];

    for (const item of transferItems) {
      const srcDocId = getStockDocId(tr.sourceWarehouseId, item.itemCode);
      sourceStockDocRefs.push(doc(db, 'stocks', srcDocId));

      if (nextStatus === 'Received') {
        const destDocId = getStockDocId(tr.destWarehouseId, item.itemCode);
        destStockDocRefs.push(doc(db, 'stocks', destDocId));
      }
    }

    // Read all source and destination stock documents
    const sourceStockSnaps = await Promise.all(sourceStockDocRefs.map(ref => transaction.get(ref)));
    const destStockSnaps = nextStatus === 'Received'
      ? await Promise.all(destStockDocRefs.map(ref => transaction.get(ref)))
      : [];

    // 2. IN-MEMORY COMPUTATION
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString();

    let totalShortQty = 0;
    const updatedItems = [...transferItems];

    interface StockWriteOp {
      ref: DocumentReference;
      data: Stock;
    }
    interface MovementWriteOp {
      ref: DocumentReference;
      data: StockMovement;
    }

    const stockWrites: StockWriteOp[] = [];
    const movementWrites: MovementWriteOp[] = [];

    for (let i = 0; i < transferItems.length; i++) {
      const item = transferItems[i];
      const barcode = productBarcodes[item.itemCode] || `BAR-${item.itemCode}`;
      const srcSnap = sourceStockSnaps[i];
      const srcExistingStock = srcSnap.exists() ? (srcSnap.data() as Stock) : null;

      // TRANSITION: Approved -> Dispatched
      if (nextStatus === 'Dispatched') {
        // Step 1: Decrement source availableQty
        let srcStock = calculateUpdatedStock(
          srcExistingStock,
          tr.sourceWarehouseId,
          tr.sourceWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'availableQty',
          -item.qty
        );

        // Step 2: Increment source inTransitQty
        srcStock = calculateUpdatedStock(
          srcStock,
          tr.sourceWarehouseId,
          tr.sourceWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'inTransitQty',
          item.qty
        );

        stockWrites.push({ ref: sourceStockDocRefs[i], data: srcStock });

        const mvtRef = doc(collection(db, 'movements'));
        movementWrites.push({
          ref: mvtRef,
          data: {
            date: dateStr,
            time: timeStr,
            itemCode: item.itemCode,
            itemName: item.itemName,
            warehouseId: tr.sourceWarehouseId,
            warehouseName: tr.sourceWarehouseName,
            qty: -item.qty,
            transactionType: 'Transfer Out',
            referenceNumber: tr.transferNumber,
            user,
            remarks: `Dispatched to warehouse ${tr.destWarehouseName}. Marked In-Transit.`,
            fromWarehouseId: tr.sourceWarehouseId,
            fromWarehouseName: tr.sourceWarehouseName,
            toWarehouseId: tr.destWarehouseId,
            toWarehouseName: tr.destWarehouseName
          }
        });
      }

      // TRANSITION: In Transit or Dispatched -> Received
      if (nextStatus === 'Received') {
        const destSnap = destStockSnaps[i];
        const destExistingStock = destSnap && destSnap.exists() ? (destSnap.data() as Stock) : null;

        const rItem = receiptDetails?.items?.find(r => r.itemCode === item.itemCode);
        const actualReceived = rItem && rItem.receivedQty !== undefined ? Number(rItem.receivedQty) : item.qty;
        const shortAmt = rItem && rItem.shortQty !== undefined ? Number(rItem.shortQty) : Math.max(0, item.qty - actualReceived);
        const shortReason = rItem?.shortReason || '';

        totalShortQty += shortAmt;
        updatedItems[i] = {
          ...item,
          receivedQty: actualReceived,
          shortQty: shortAmt,
          shortReason: shortReason
        };

        // 1. Decrement source inTransitQty by full dispatched qty
        const srcStock = calculateUpdatedStock(
          srcExistingStock,
          tr.sourceWarehouseId,
          tr.sourceWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'inTransitQty',
          -item.qty
        );
        stockWrites.push({ ref: sourceStockDocRefs[i], data: srcStock });

        // 2. Increment dest availableQty by actual received qty
        const destStock = calculateUpdatedStock(
          destExistingStock,
          tr.destWarehouseId,
          tr.destWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'availableQty',
          actualReceived
        );
        stockWrites.push({ ref: destStockDocRefs[i], data: destStock });

        // 3. Movement ledger: Transfer In
        const mvtInRef = doc(collection(db, 'movements'));
        movementWrites.push({
          ref: mvtInRef,
          data: {
            date: dateStr,
            time: timeStr,
            itemCode: item.itemCode,
            itemName: item.itemName,
            warehouseId: tr.destWarehouseId,
            warehouseName: tr.destWarehouseName,
            qty: actualReceived,
            transactionType: 'Transfer In',
            referenceNumber: tr.transferNumber,
            user,
            remarks: `Received ${actualReceived} Pcs into destination warehouse inventory. ${remarks || ''}`,
            fromWarehouseId: tr.sourceWarehouseId,
            fromWarehouseName: tr.sourceWarehouseName,
            toWarehouseId: tr.destWarehouseId,
            toWarehouseName: tr.destWarehouseName
          }
        });

        // 4. Movement ledger: Shortage if any
        if (shortAmt > 0) {
          const mvtShortRef = doc(collection(db, 'movements'));
          movementWrites.push({
            ref: mvtShortRef,
            data: {
              date: dateStr,
              time: timeStr,
              itemCode: item.itemCode,
              itemName: item.itemName,
              warehouseId: tr.destWarehouseId,
              warehouseName: tr.destWarehouseName,
              qty: -shortAmt,
              transactionType: 'Transfer Shortage',
              referenceNumber: tr.transferNumber,
              user,
              remarks: `Short material received: ${shortAmt} Pcs missing out of ${item.qty} Pcs dispatched. Reason: ${shortReason || 'Quantity Mismatch'}`,
              fromWarehouseId: tr.sourceWarehouseId,
              fromWarehouseName: tr.sourceWarehouseName,
              toWarehouseId: tr.destWarehouseId,
              toWarehouseName: tr.destWarehouseName
            }
          });
        }
      }
    }

    // 3. ALL WRITES
    const updateData: Partial<Transfer> = {
      status: nextStatus,
      items: updatedItems,
      updatedAt: now.toISOString(),
      updatedBy: user
    };

    if (nextStatus === 'Approved') {
      updateData.approvedBy = `${currentRole} Supervisor`;
      updateData.approvedAt = now.toISOString();
    } else if (nextStatus === 'Dispatched') {
      updateData.dispatchedBy = user;
      updateData.dispatchedAt = now.toISOString();
    } else if (nextStatus === 'Received') {
      updateData.receivedBy = user;
      updateData.receivedAt = now.toISOString();
      updateData.hasShortage = totalShortQty > 0;
      updateData.totalShortQty = totalShortQty;
      if (receiptDetails?.receivingRemarks) {
        updateData.receivingRemarks = receiptDetails.receivingRemarks;
      }
    }

    // Apply all stock changes
    for (const write of stockWrites) {
      transaction.set(write.ref, write.data, { merge: true });
    }

    // Apply all movement ledger entries
    for (const mvt of movementWrites) {
      transaction.set(mvt.ref, mvt.data);
    }

    // Update transfer document
    transaction.update(transferDocRef, updateData);

    return { success: true, oldStatus, nextStatus };
  });
}

// ============================================================================
// 4. ATOMIC TRANSFER REVERSAL / UNDO
// Writes: Reverted Stock Docs + Reversal Movements + Updated Transfer Doc
// ============================================================================
export async function undoTransferAtomic(
  db: Firestore,
  params: {
    transferId: string;
    targetStatus: 'Pending Approval' | 'Draft';
    user: string;
    role: UserRole;
    productBarcodes?: Record<string, string>;
  }
): Promise<{ success: boolean; transferNumber: string }> {
  const { transferId, targetStatus, user, role, productBarcodes = {} } = params;
  assertSuperAdmin(role, 'undo or revert Transfer orders');
  const transferDocRef = doc(db, 'transfers', transferId);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const transferSnap = await transaction.get(transferDocRef);
    if (!transferSnap.exists()) {
      throw new Error(`Transfer order ${transferId} not found.`);
    }

    const tr = transferSnap.data() as Transfer;
    const transferItems = tr.items && tr.items.length > 0
      ? tr.items
      : [{ itemCode: tr.itemCode, itemName: tr.itemName, qty: tr.qty, receivedQty: tr.qty, shortQty: 0 }];

    const sourceStockDocRefs: DocumentReference[] = [];
    const destStockDocRefs: DocumentReference[] = [];

    for (const item of transferItems) {
      sourceStockDocRefs.push(doc(db, 'stocks', getStockDocId(tr.sourceWarehouseId, item.itemCode)));
      if (tr.status === 'Received' || tr.status === 'Closed') {
        destStockDocRefs.push(doc(db, 'stocks', getStockDocId(tr.destWarehouseId, item.itemCode)));
      }
    }

    const sourceStockSnaps = await Promise.all(sourceStockDocRefs.map(ref => transaction.get(ref)));
    const destStockSnaps = destStockDocRefs.length > 0
      ? await Promise.all(destStockDocRefs.map(ref => transaction.get(ref)))
      : [];

    // 2. IN-MEMORY COMPUTATION
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString();

    interface StockWriteOp { ref: DocumentReference; data: Stock; }
    interface MovementWriteOp { ref: DocumentReference; data: StockMovement; }

    const stockWrites: StockWriteOp[] = [];
    const movementWrites: MovementWriteOp[] = [];

    // If status was Dispatched / In Transit
    if (tr.status === 'Dispatched' || tr.status === 'In Transit') {
      for (let i = 0; i < transferItems.length; i++) {
        const item = transferItems[i];
        const barcode = productBarcodes[item.itemCode] || `BAR-${item.itemCode}`;
        const srcSnap = sourceStockSnaps[i];
        const srcExistingStock = srcSnap.exists() ? (srcSnap.data() as Stock) : null;

        // Restore availableQty in source (add back)
        let srcStock = calculateUpdatedStock(
          srcExistingStock,
          tr.sourceWarehouseId,
          tr.sourceWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'availableQty',
          item.qty
        );

        // Remove inTransitQty from source
        srcStock = calculateUpdatedStock(
          srcStock,
          tr.sourceWarehouseId,
          tr.sourceWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'inTransitQty',
          -item.qty
        );

        stockWrites.push({ ref: sourceStockDocRefs[i], data: srcStock });

        const mvtRef = doc(collection(db, 'movements'));
        movementWrites.push({
          ref: mvtRef,
          data: {
            date: dateStr,
            time: timeStr,
            itemCode: item.itemCode,
            itemName: item.itemName,
            warehouseId: tr.sourceWarehouseId,
            warehouseName: tr.sourceWarehouseName,
            qty: item.qty,
            transactionType: 'Transfer (Reversal)',
            referenceNumber: `REV-${tr.transferNumber}`,
            user,
            remarks: `[Admin Undo] Restored source warehouse balance of ${item.qty} Pcs for ${tr.transferNumber}`
          }
        });
      }
    }

    // If status was Received or Closed
    if (tr.status === 'Received' || tr.status === 'Closed') {
      for (let i = 0; i < transferItems.length; i++) {
        const item = transferItems[i];
        const barcode = productBarcodes[item.itemCode] || `BAR-${item.itemCode}`;
        const actualRec = item.receivedQty !== undefined ? item.receivedQty : item.qty;

        const srcSnap = sourceStockSnaps[i];
        const srcExistingStock = srcSnap.exists() ? (srcSnap.data() as Stock) : null;

        const destSnap = destStockSnaps[i];
        const destExistingStock = destSnap && destSnap.exists() ? (destSnap.data() as Stock) : null;

        // Revert dest availableQty (subtract actual received)
        const destStock = calculateUpdatedStock(
          destExistingStock,
          tr.destWarehouseId,
          tr.destWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'availableQty',
          -actualRec
        );
        stockWrites.push({ ref: destStockDocRefs[i], data: destStock });

        // Restore source availableQty (add back full dispatched)
        const srcStock = calculateUpdatedStock(
          srcExistingStock,
          tr.sourceWarehouseId,
          tr.sourceWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'availableQty',
          item.qty
        );
        stockWrites.push({ ref: sourceStockDocRefs[i], data: srcStock });

        // Compensating movements
        const mvtDestRef = doc(collection(db, 'movements'));
        movementWrites.push({
          ref: mvtDestRef,
          data: {
            date: dateStr,
            time: timeStr,
            itemCode: item.itemCode,
            itemName: item.itemName,
            warehouseId: tr.destWarehouseId,
            warehouseName: tr.destWarehouseName,
            qty: -actualRec,
            transactionType: 'Transfer (Reversal)',
            referenceNumber: `REV-${tr.transferNumber}`,
            user,
            remarks: `[Admin Undo] Reverted transfer receipt of ${actualRec} Pcs for ${tr.transferNumber}`
          }
        });

        const mvtSrcRef = doc(collection(db, 'movements'));
        movementWrites.push({
          ref: mvtSrcRef,
          data: {
            date: dateStr,
            time: timeStr,
            itemCode: item.itemCode,
            itemName: item.itemName,
            warehouseId: tr.sourceWarehouseId,
            warehouseName: tr.sourceWarehouseName,
            qty: item.qty,
            transactionType: 'Transfer (Reversal)',
            referenceNumber: `REV-${tr.transferNumber}`,
            user,
            remarks: `[Admin Undo] Restored source warehouse balance of ${item.qty} Pcs for ${tr.transferNumber}`
          }
        });
      }
    }

    // 3. ALL WRITES
    for (const write of stockWrites) {
      transaction.set(write.ref, write.data, { merge: true });
    }
    for (const mvt of movementWrites) {
      transaction.set(mvt.ref, mvt.data);
    }

    transaction.update(transferDocRef, {
      status: targetStatus,
      hasShortage: false,
      totalShortQty: 0,
      receivingRemarks: '',
      updatedAt: now.toISOString(),
      updatedBy: user,
      remarks: `[ENTRY UNDONE BY ADMIN] Reverted stock balances. Status reset to ${targetStatus}. Original remarks: ${tr.remarks || ''}`
    });

    return { success: true, transferNumber: tr.transferNumber };
  });
}

// ============================================================================
// 5. ATOMIC MANUAL STOCK ADJUSTMENT
// Writes: Updated Stock Doc + Movement Doc
// ============================================================================
export async function postStockAdjustmentAtomic(
  db: Firestore,
  adj: {
    itemCode: string;
    itemName: string;
    warehouseId: string;
    warehouseName: string;
    barcode: string;
    type: 'Increase' | 'Decrease' | 'Damage' | 'Shortage' | 'Excess';
    qty: number;
    reason: string;
    remarks: string;
    user: string;
    role: UserRole;
  }
): Promise<{ movementId: string; overrideDocNo: string; stockDocId: string }> {
  assertSuperAdmin(adj.role, 'execute manual stock level overrides');
  const stockDocId = getStockDocId(adj.warehouseId, adj.itemCode);
  const stockDocRef = doc(db, 'stocks', stockDocId);
  const movementDocRef = doc(collection(db, 'movements'));
  const overrideDocNo = `ADJ-${Math.floor(100000 + Math.random() * 900000)}`;

  await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const stockSnap = await transaction.get(stockDocRef);
    const existingStock = stockSnap.exists() ? (stockSnap.data() as Stock) : null;

    // 2. IN-MEMORY COMPUTATION
    let updatedStock: Stock;
    let transactionLabel = '';
    let movementQty = adj.qty;

    if (adj.type === 'Increase' || adj.type === 'Excess') {
      transactionLabel = 'Adjustment (Add)';
      movementQty = adj.qty;
      updatedStock = calculateUpdatedStock(
        existingStock,
        adj.warehouseId,
        adj.warehouseName,
        adj.itemCode,
        adj.itemName,
        adj.barcode,
        'availableQty',
        adj.qty
      );
    } else if (adj.type === 'Decrease' || adj.type === 'Shortage') {
      transactionLabel = 'Adjustment (Sub)';
      movementQty = -adj.qty;
      updatedStock = calculateUpdatedStock(
        existingStock,
        adj.warehouseId,
        adj.warehouseName,
        adj.itemCode,
        adj.itemName,
        adj.barcode,
        'availableQty',
        -adj.qty
      );
    } else {
      // Damage: Decrement available, Increment damaged
      transactionLabel = 'Adjustment (Damage)';
      movementQty = adj.qty;
      let temp = calculateUpdatedStock(
        existingStock,
        adj.warehouseId,
        adj.warehouseName,
        adj.itemCode,
        adj.itemName,
        adj.barcode,
        'availableQty',
        -adj.qty
      );
      updatedStock = calculateUpdatedStock(
        temp,
        adj.warehouseId,
        adj.warehouseName,
        adj.itemCode,
        adj.itemName,
        adj.barcode,
        'damagedQty',
        adj.qty
      );
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString();

    const movementData: Omit<StockMovement, 'id'> = {
      date: dateStr,
      time: timeStr,
      itemCode: adj.itemCode,
      itemName: adj.itemName,
      warehouseId: adj.warehouseId,
      warehouseName: adj.warehouseName,
      qty: movementQty,
      transactionType: transactionLabel,
      referenceNumber: overrideDocNo,
      user: adj.user,
      remarks: `Reason: ${adj.reason}. Remarks: ${adj.remarks}`,
      adjustmentType: adj.type,
      isReverted: false
    };

    // 3. ALL WRITES
    transaction.set(stockDocRef, updatedStock, { merge: true });
    transaction.set(movementDocRef, movementData);
  });

  return {
    movementId: movementDocRef.id,
    overrideDocNo,
    stockDocId
  };
}

// ============================================================================
// 6. ATOMIC REVERT MANUAL STOCK ADJUSTMENT
// Writes: Restored Stock Doc + Reversal Movement Doc
// ============================================================================
export async function revertStockAdjustmentAtomic(
  db: Firestore,
  params: {
    originalMovementId: string;
    reason: string;
    user: string;
    role: UserRole;
    productBarcodes?: Record<string, string>;
  }
): Promise<{ reversalMovementId: string; revRef: string }> {
  const { originalMovementId, reason, user, role, productBarcodes = {} } = params;
  assertSuperAdmin(role, 'revert manual stock level overrides');
  const origMvtRef = doc(db, 'movements', originalMovementId);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const origMvtSnap = await transaction.get(origMvtRef);
    if (!origMvtSnap.exists()) {
      throw new Error(`Original movement ${originalMovementId} not found.`);
    }

    const mvt = origMvtSnap.data() as StockMovement;
    if (mvt.reversalOf) {
      throw new Error("A reversal movement cannot be reversed.");
    }

    const stockDocId = getStockDocId(mvt.warehouseId, mvt.itemCode);
    const stockDocRef = doc(db, 'stocks', stockDocId);
    const stockSnap = await transaction.get(stockDocRef);
    const existingStock = stockSnap.exists() ? (stockSnap.data() as Stock) : null;

    // 2. IN-MEMORY COMPUTATION
    const barcode = productBarcodes[mvt.itemCode] || `BAR-${mvt.itemCode}`;
    const absQty = Math.abs(mvt.qty);
    let updatedStock: Stock;

    if (mvt.transactionType.includes('Damage') || mvt.adjustmentType === 'Damage') {
      let temp = calculateUpdatedStock(
        existingStock,
        mvt.warehouseId,
        mvt.warehouseName,
        mvt.itemCode,
        mvt.itemName,
        barcode,
        'availableQty',
        absQty
      );
      updatedStock = calculateUpdatedStock(
        temp,
        mvt.warehouseId,
        mvt.warehouseName,
        mvt.itemCode,
        mvt.itemName,
        barcode,
        'damagedQty',
        -absQty
      );
    } else if (
      mvt.transactionType.includes('(Add)') ||
      mvt.transactionType.includes('Increase') ||
      mvt.transactionType.includes('Excess') ||
      mvt.adjustmentType === 'Increase' ||
      mvt.adjustmentType === 'Excess' ||
      mvt.qty > 0
    ) {
      updatedStock = calculateUpdatedStock(
        existingStock,
        mvt.warehouseId,
        mvt.warehouseName,
        mvt.itemCode,
        mvt.itemName,
        barcode,
        'availableQty',
        -absQty
      );
    } else {
      updatedStock = calculateUpdatedStock(
        existingStock,
        mvt.warehouseId,
        mvt.warehouseName,
        mvt.itemCode,
        mvt.itemName,
        barcode,
        'availableQty',
        absQty
      );
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString();
    const revRef = `REV-${mvt.referenceNumber || originalMovementId}`;
    const reversalQty = (mvt.transactionType.includes('(Add)') || mvt.qty > 0) ? -absQty : absQty;

    const reversalMvtDocRef = doc(collection(db, 'movements'));
    const reversalMvtData: Omit<StockMovement, 'id'> = {
      date: dateStr,
      time: timeStr,
      itemCode: mvt.itemCode,
      itemName: mvt.itemName,
      warehouseId: mvt.warehouseId,
      warehouseName: mvt.warehouseName,
      qty: reversalQty,
      transactionType: 'Adjustment (Reversal)',
      referenceNumber: revRef,
      user,
      reversalOf: originalMovementId,
      remarks: `REVERSAL of manual adjustment ${mvt.referenceNumber || originalMovementId}. Restored previous balance (${absQty} Pcs). Reason: ${reason}`
    };

    // 3. ALL WRITES
    transaction.set(stockDocRef, updatedStock, { merge: true });
    transaction.set(reversalMvtDocRef, reversalMvtData);

    return {
      reversalMovementId: reversalMvtDocRef.id,
      revRef
    };
  });
}

// ============================================================================
// 7. ATOMIC PRODUCT CREATION WITH OPENING STOCK
// Writes: Product Doc + (Optional: Stock Doc + Opening Movement Doc)
// ============================================================================
export async function addProductWithInitialStockAtomic(
  db: Firestore,
  params: {
    product: Product;
    openingStock?: number;
    openingWarehouseId?: string;
    warehouseName?: string;
    user?: string;
    role: UserRole;
  }
): Promise<{ productId: string; stockDocId?: string; movementId?: string }> {
  const { product, openingStock, openingWarehouseId, warehouseName, user, role } = params;
  assertCanWriteStock(role, 'initialize product opening stock');
  const productDocRef = doc(collection(db, 'products'));

  const hasOpeningStock = !!(openingStock && openingStock > 0 && openingWarehouseId);
  const stockDocId = hasOpeningStock ? getStockDocId(openingWarehouseId!, product.itemCode) : undefined;
  const stockDocRef = hasOpeningStock ? doc(db, 'stocks', stockDocId!) : null;
  const movementDocRef = hasOpeningStock ? doc(collection(db, 'movements')) : null;

  await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    let existingStock: Stock | null = null;
    if (stockDocRef) {
      const stockSnap = await transaction.get(stockDocRef);
      if (stockSnap.exists()) {
        existingStock = stockSnap.data() as Stock;
      }
    }

    // 2. IN-MEMORY COMPUTATION
    let updatedStock: Stock | null = null;
    let movementData: Omit<StockMovement, 'id'> | null = null;

    if (hasOpeningStock && stockDocRef && movementDocRef) {
      const whName = warehouseName || 'Primary Warehouse';
      updatedStock = calculateUpdatedStock(
        existingStock,
        openingWarehouseId!,
        whName,
        product.itemCode,
        product.name,
        product.barcode,
        'availableQty',
        openingStock!
      );

      const now = new Date();
      movementData = {
        date: now.toISOString().slice(0, 10),
        time: now.toLocaleTimeString(),
        itemCode: product.itemCode,
        itemName: product.name,
        warehouseId: openingWarehouseId!,
        warehouseName: whName,
        qty: openingStock!,
        user: user || `${role} Operator`,
        transactionType: 'Adjustment (Add)',
        referenceNumber: `OP-${product.itemCode}`,
        remarks: 'Opening Stock Balance Initialization'
      };
    }

    // 3. ALL WRITES
    transaction.set(productDocRef, {
      ...product,
      id: productDocRef.id
    });

    if (stockDocRef && updatedStock) {
      transaction.set(stockDocRef, updatedStock, { merge: true });
    }

    if (movementDocRef && movementData) {
      transaction.set(movementDocRef, movementData);
    }
  });

  return {
    productId: productDocRef.id,
    stockDocId,
    movementId: movementDocRef?.id
  };
}

// ============================================================================
// 8. ATOMIC DELETE INWARD WITH STOCK REVERSAL
// Writes: Delete Inward Doc + Restore Stock Doc + Inward Reversal Movement
// ============================================================================
export async function deleteInwardAtomic(
  db: Firestore,
  inwardId: string,
  role: UserRole,
  user: string = 'Super Admin',
  productBarcodes: Record<string, string> = {}
): Promise<{ success: boolean; grnNumber: string }> {
  assertSuperAdmin(role, 'delete Inward GRN records');
  const inwardDocRef = doc(db, 'inwards', inwardId);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const inwardSnap = await transaction.get(inwardDocRef);
    if (!inwardSnap.exists()) {
      throw new Error(`Inward document ${inwardId} not found.`);
    }

    const inward = inwardSnap.data() as Inward;
    const stockDocId = getStockDocId(inward.warehouseId, inward.itemCode);
    const stockDocRef = doc(db, 'stocks', stockDocId);
    const stockSnap = await transaction.get(stockDocRef);
    const existingStock = stockSnap.exists() ? (stockSnap.data() as Stock) : null;

    // 2. IN-MEMORY COMPUTATION
    const barcode = productBarcodes[inward.itemCode] || `BAR-${inward.itemCode}`;
    const updatedStock = calculateUpdatedStock(
      existingStock,
      inward.warehouseId,
      inward.warehouseName,
      inward.itemCode,
      inward.itemName,
      barcode,
      'availableQty',
      -inward.qty
    );

    const now = new Date();
    const reversalMvtRef = doc(collection(db, 'movements'));
    const reversalMvtData: Omit<StockMovement, 'id'> = {
      date: now.toISOString().slice(0, 10),
      time: now.toLocaleTimeString(),
      itemCode: inward.itemCode,
      itemName: inward.itemName,
      warehouseId: inward.warehouseId,
      warehouseName: inward.warehouseName,
      qty: -inward.qty,
      transactionType: 'Inward (Reversal)',
      referenceNumber: `REV-${inward.grnNumber}`,
      user,
      remarks: `REVERSAL of Inbound GRN ${inward.grnNumber} upon document removal.`
    };

    // 3. ALL WRITES
    transaction.delete(inwardDocRef);
    transaction.set(stockDocRef, updatedStock, { merge: true });
    transaction.set(reversalMvtRef, reversalMvtData);

    return { success: true, grnNumber: inward.grnNumber };
  });
}

// ============================================================================
// 9. ATOMIC DELETE OUTWARD WITH STOCK REVERSAL
// Writes: Delete Outward Doc + Restore Stock Doc + Outward Reversal Movement
// ============================================================================
export async function deleteOutwardAtomic(
  db: Firestore,
  outwardId: string,
  role: UserRole,
  user: string = 'Super Admin',
  productBarcodes: Record<string, string> = {}
): Promise<{ success: boolean; dispatchNumber: string }> {
  assertSuperAdmin(role, 'delete Outward Dispatch records');
  const outwardDocRef = doc(db, 'outwards', outwardId);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const outwardSnap = await transaction.get(outwardDocRef);
    if (!outwardSnap.exists()) {
      throw new Error(`Outward document ${outwardId} not found.`);
    }

    const outward = outwardSnap.data() as Outward;
    const stockDocId = getStockDocId(outward.warehouseId, outward.itemCode);
    const stockDocRef = doc(db, 'stocks', stockDocId);
    const stockSnap = await transaction.get(stockDocRef);
    const existingStock = stockSnap.exists() ? (stockSnap.data() as Stock) : null;

    // 2. IN-MEMORY COMPUTATION
    const barcode = productBarcodes[outward.itemCode] || `BAR-${outward.itemCode}`;
    const updatedStock = calculateUpdatedStock(
      existingStock,
      outward.warehouseId,
      outward.warehouseName,
      outward.itemCode,
      outward.itemName,
      barcode,
      'availableQty',
      outward.qty
    );

    const now = new Date();
    const reversalMvtRef = doc(collection(db, 'movements'));
    const reversalMvtData: Omit<StockMovement, 'id'> = {
      date: now.toISOString().slice(0, 10),
      time: now.toLocaleTimeString(),
      itemCode: outward.itemCode,
      itemName: outward.itemName,
      warehouseId: outward.warehouseId,
      warehouseName: outward.warehouseName,
      qty: outward.qty,
      transactionType: 'Outward (Reversal)',
      referenceNumber: `REV-${outward.dispatchNumber}`,
      user,
      remarks: `REVERSAL of Outbound Dispatch ${outward.dispatchNumber} upon document removal.`
    };

    // 3. ALL WRITES
    transaction.delete(outwardDocRef);
    transaction.set(stockDocRef, updatedStock, { merge: true });
    transaction.set(reversalMvtRef, reversalMvtData);

    return { success: true, dispatchNumber: outward.dispatchNumber };
  });
}

// ============================================================================
// 9.1 ATOMIC EDIT OUTWARD DISPATCH GROUP (HEADER & ITEMS)
// Writes: Updated/Replaced Outward Docs + Adjusted Stock Docs + Movement Ledger Docs
// ============================================================================
export async function editOutwardGroupAtomic(
  db: Firestore,
  params: {
    dispatchNumber: string;
    updatedVoucher: {
      date: string;
      customerId: string;
      customerName: string;
      warehouseId: string;
      warehouseName: string;
      vehicleNumber: string;
      driverName: string;
      transportName: string;
      remarks: string;
      invoiceNumber?: string;
    };
    updatedItems: Array<{
      itemCode: string;
      itemName: string;
      qty: number;
    }>;
    role: UserRole;
    user?: string;
    productBarcodes?: Record<string, string>;
  }
): Promise<{ success: boolean; dispatchNumber: string; updatedItemCount: number }> {
  const { dispatchNumber, updatedVoucher, updatedItems, role, user = 'Super Admin', productBarcodes = {} } = params;
  assertCanWriteStock(role, 'edit Outward Customer Dispatches');

  if (!updatedItems || updatedItems.length === 0) {
    throw new Error('Customer dispatch voucher must contain at least one line item.');
  }

  // Find all existing outwards matching this dispatchNumber
  const outwardsQuery = query(collection(db, 'outwards'), where('dispatchNumber', '==', dispatchNumber));
  const existingOutwardsSnap = await getDocs(outwardsQuery);
  if (existingOutwardsSnap.empty) {
    throw new Error(`No customer dispatch records found for dispatch number "${dispatchNumber}".`);
  }

  const existingOutwards: Array<{ id: string; data: Outward }> = existingOutwardsSnap.docs.map(d => ({
    id: d.id,
    data: d.data() as Outward
  }));

  const warehouseId = updatedVoucher.warehouseId || existingOutwards[0].data.warehouseId;
  const warehouseName = updatedVoucher.warehouseName || existingOutwards[0].data.warehouseName;

  // Collect all unique item codes across existing and updated items
  const allItemCodes = new Set<string>();
  existingOutwards.forEach(o => allItemCodes.add(o.data.itemCode));
  updatedItems.forEach(i => allItemCodes.add(i.itemCode));

  const stockDocRefs: Record<string, DocumentReference> = {};
  for (const code of allItemCodes) {
    stockDocRefs[code] = doc(db, 'stocks', getStockDocId(warehouseId, code));
  }

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const stockSnaps: Record<string, Stock | null> = {};
    for (const [code, ref] of Object.entries(stockDocRefs)) {
      const sSnap = await transaction.get(ref);
      stockSnaps[code] = sSnap.exists() ? (sSnap.data() as Stock) : null;
    }

    // 2. IN-MEMORY COMPUTATION OF NET STOCK DELTAS
    const oldQtyMap: Record<string, number> = {};
    existingOutwards.forEach(o => {
      oldQtyMap[o.data.itemCode] = (oldQtyMap[o.data.itemCode] || 0) + o.data.qty;
    });

    const newQtyMap: Record<string, number> = {};
    updatedItems.forEach(i => {
      newQtyMap[i.itemCode] = (newQtyMap[i.itemCode] || 0) + i.qty;
    });

    const now = new Date();
    const dateStr = updatedVoucher.date || now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString();

    const stockWrites: Array<{ ref: DocumentReference; data: Partial<Stock> }> = [];
    const movementWrites: Array<{ ref: DocumentReference; data: Omit<StockMovement, 'id'> }> = [];

    for (const code of allItemCodes) {
      const oldQty = oldQtyMap[code] || 0;
      const newQty = newQtyMap[code] || 0;
      const netDelta = oldQty - newQty; // Positive = add back stock; Negative = deduct more stock

      const existingStock = stockSnaps[code];
      const prodName = updatedItems.find(i => i.itemCode === code)?.itemName || existingOutwards.find(o => o.data.itemCode === code)?.data.itemName || `Item ${code}`;
      const barcode = productBarcodes[code] || `BAR-${code}`;

      if (netDelta !== 0) {
        const updatedStock = calculateUpdatedStock(
          existingStock,
          warehouseId,
          warehouseName,
          code,
          prodName,
          barcode,
          'availableQty',
          netDelta
        );

        if ((updatedStock.availableQty || 0) < 0) {
          throw new Error(`NEGATIVE SALES BLOCK: Editing dispatch ${dispatchNumber} for product "${prodName}" (${code}) would cause negative stock balance (${updatedStock.availableQty} Pcs) in ${warehouseName}.`);
        }

        stockWrites.push({ ref: stockDocRefs[code], data: updatedStock });

        // Record adjustment movement in immutable ledger
        const mvtRef = doc(collection(db, 'movements'));
        movementWrites.push({
          ref: mvtRef,
          data: {
            date: dateStr,
            time: timeStr,
            itemCode: code,
            itemName: prodName,
            warehouseId,
            warehouseName,
            qty: -netDelta,
            transactionType: 'Outward (Dispatch)',
            referenceNumber: dispatchNumber,
            user,
            remarks: `[Voucher Edit] Dispatch ${dispatchNumber} item adjustment (Old Qty: ${oldQty}, New Qty: ${newQty}, Diff: ${-netDelta} Pcs). Inv: ${updatedVoucher.invoiceNumber || 'N/A'}.`
          }
        });
      }
    }

    // 3. OUTWARD DOCUMENT SYNCHRONIZATION
    const minLen = Math.min(existingOutwards.length, updatedItems.length);

    for (let i = 0; i < minLen; i++) {
      const outRef = doc(db, 'outwards', existingOutwards[i].id);
      const item = updatedItems[i];
      transaction.update(outRef, {
        dispatchNumber,
        date: dateStr,
        customerId: updatedVoucher.customerId,
        customerName: updatedVoucher.customerName,
        warehouseId,
        warehouseName,
        itemCode: item.itemCode,
        itemName: item.itemName,
        qty: item.qty,
        vehicleNumber: updatedVoucher.vehicleNumber || 'N/A',
        driverName: updatedVoucher.driverName || 'N/A',
        transportName: updatedVoucher.transportName || 'N/A',
        remarks: updatedVoucher.remarks || 'Customer order dispatch.',
        invoiceNumber: updatedVoucher.invoiceNumber || 'N/A',
        updatedAt: now.toISOString(),
        updatedBy: user
      });
    }

    // Delete extra outward docs if new item list is shorter
    if (existingOutwards.length > updatedItems.length) {
      for (let i = minLen; i < existingOutwards.length; i++) {
        const outRef = doc(db, 'outwards', existingOutwards[i].id);
        transaction.delete(outRef);
      }
    }

    // Create new outward docs if new item list is longer
    if (updatedItems.length > existingOutwards.length) {
      for (let i = minLen; i < updatedItems.length; i++) {
        const outRef = doc(collection(db, 'outwards'));
        const item = updatedItems[i];
        transaction.set(outRef, {
          dispatchNumber,
          date: dateStr,
          customerId: updatedVoucher.customerId,
          customerName: updatedVoucher.customerName,
          warehouseId,
          warehouseName,
          itemCode: item.itemCode,
          itemName: item.itemName,
          qty: item.qty,
          vehicleNumber: updatedVoucher.vehicleNumber || 'N/A',
          driverName: updatedVoucher.driverName || 'N/A',
          transportName: updatedVoucher.transportName || 'N/A',
          remarks: updatedVoucher.remarks || 'Customer order dispatch.',
          invoiceNumber: updatedVoucher.invoiceNumber || 'N/A',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          updatedBy: user
        });
      }
    }

    // 4. WRITE STOCKS & MOVEMENTS
    for (const sw of stockWrites) {
      transaction.set(sw.ref, sw.data, { merge: true });
    }
    for (const mw of movementWrites) {
      transaction.set(mw.ref, mw.data);
    }

    return { success: true, dispatchNumber, updatedItemCount: updatedItems.length };
  });
}

// ============================================================================
// 9.2 ATOMIC DELETE ENTIRE OUTWARD DISPATCH GROUP BY DISPATCH NUMBER
// Writes: Delete Outward Docs + Restore Stock Docs + Reversal Movements
// ============================================================================
export async function deleteOutwardGroupAtomic(
  db: Firestore,
  dispatchNumber: string,
  role: UserRole,
  user: string = 'Super Admin',
  productBarcodes: Record<string, string> = {}
): Promise<{ success: boolean; dispatchNumber: string; deletedCount: number }> {
  assertCanWriteStock(role, 'delete Outward Customer Dispatch orders');

  const outwardsQuery = query(collection(db, 'outwards'), where('dispatchNumber', '==', dispatchNumber));
  const existingOutwardsSnap = await getDocs(outwardsQuery);
  if (existingOutwardsSnap.empty) {
    throw new Error(`No customer dispatch records found for dispatch number "${dispatchNumber}".`);
  }

  const existingOutwards: Array<{ id: string; data: Outward }> = existingOutwardsSnap.docs.map(d => ({
    id: d.id,
    data: d.data() as Outward
  }));

  const warehouseId = existingOutwards[0].data.warehouseId;
  const warehouseName = existingOutwards[0].data.warehouseName;

  // Aggregate quantities by itemCode to restore stock
  const qtyMap: Record<string, { itemName: string; qty: number }> = {};
  existingOutwards.forEach(o => {
    if (!qtyMap[o.data.itemCode]) {
      qtyMap[o.data.itemCode] = { itemName: o.data.itemName, qty: 0 };
    }
    qtyMap[o.data.itemCode].qty += o.data.qty;
  });

  const stockDocRefs: Record<string, DocumentReference> = {};
  for (const code of Object.keys(qtyMap)) {
    stockDocRefs[code] = doc(db, 'stocks', getStockDocId(warehouseId, code));
  }

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const stockSnaps: Record<string, Stock | null> = {};
    for (const [code, ref] of Object.entries(stockDocRefs)) {
      const sSnap = await transaction.get(ref);
      stockSnaps[code] = sSnap.exists() ? (sSnap.data() as Stock) : null;
    }

    // 2. IN-MEMORY COMPUTATION (RESTORE STOCK)
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString();

    const stockWrites: Array<{ ref: DocumentReference; data: Partial<Stock> }> = [];
    const movementWrites: Array<{ ref: DocumentReference; data: Omit<StockMovement, 'id'> }> = [];

    for (const [code, info] of Object.entries(qtyMap)) {
      const existingStock = stockSnaps[code];
      const barcode = productBarcodes[code] || `BAR-${code}`;

      const updatedStock = calculateUpdatedStock(
        existingStock,
        warehouseId,
        warehouseName,
        code,
        info.itemName,
        barcode,
        'availableQty',
        info.qty
      );

      stockWrites.push({ ref: stockDocRefs[code], data: updatedStock });

      const reversalMvtRef = doc(collection(db, 'movements'));
      movementWrites.push({
        ref: reversalMvtRef,
        data: {
          date: dateStr,
          time: timeStr,
          itemCode: code,
          itemName: info.itemName,
          warehouseId,
          warehouseName,
          qty: info.qty,
          transactionType: 'Outward (Reversal)',
          referenceNumber: `REV-${dispatchNumber}`,
          user,
          remarks: `[Admin Removal] Complete deletion of Dispatch Order ${dispatchNumber} (${info.qty} Pcs restored to ${warehouseName}).`
        }
      });
    }

    // 3. ALL WRITES
    for (const out of existingOutwards) {
      const outRef = doc(db, 'outwards', out.id);
      transaction.delete(outRef);
    }

    for (const sw of stockWrites) {
      transaction.set(sw.ref, sw.data, { merge: true });
    }

    for (const mw of movementWrites) {
      transaction.set(mw.ref, mw.data);
    }

    return { success: true, dispatchNumber, deletedCount: existingOutwards.length };
  });
}

// ============================================================================
// 10. ATOMIC DELETE TRANSFER WITH STOCK REVERSAL
// Writes: Delete Transfer Doc + Restore Stock Docs + Reversal Movements
// ============================================================================
export async function deleteTransferAtomic(
  db: Firestore,
  transferId: string,
  role: UserRole,
  user: string = 'Super Admin',
  productBarcodes: Record<string, string> = {}
): Promise<{ success: boolean; transferNumber: string }> {
  assertSuperAdmin(role, 'delete Transfer requests');
  const transferDocRef = doc(db, 'transfers', transferId);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const transferSnap = await transaction.get(transferDocRef);
    if (!transferSnap.exists()) {
      throw new Error(`Transfer document ${transferId} not found.`);
    }

    const tr = transferSnap.data() as Transfer;
    const transferItems = tr.items && tr.items.length > 0
      ? tr.items
      : [{ itemCode: tr.itemCode, itemName: tr.itemName, qty: tr.qty }];

    const sourceStockDocRefs: DocumentReference[] = [];
    const destStockDocRefs: DocumentReference[] = [];

    for (const item of transferItems) {
      sourceStockDocRefs.push(doc(db, 'stocks', getStockDocId(tr.sourceWarehouseId, item.itemCode)));
      if (tr.status === 'Received' || tr.status === 'Closed') {
        destStockDocRefs.push(doc(db, 'stocks', getStockDocId(tr.destWarehouseId, item.itemCode)));
      }
    }

    const sourceStockSnaps = await Promise.all(sourceStockDocRefs.map(ref => transaction.get(ref)));
    const destStockSnaps = destStockDocRefs.length > 0
      ? await Promise.all(destStockDocRefs.map(ref => transaction.get(ref)))
      : [];

    // 2. IN-MEMORY COMPUTATION
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString();

    interface StockWriteOp { ref: DocumentReference; data: Stock; }
    interface MovementWriteOp { ref: DocumentReference; data: StockMovement; }

    const stockWrites: StockWriteOp[] = [];
    const movementWrites: MovementWriteOp[] = [];

    // If status is Dispatched or In Transit
    if (tr.status === 'Dispatched' || tr.status === 'In Transit') {
      for (let i = 0; i < transferItems.length; i++) {
        const item = transferItems[i];
        const barcode = productBarcodes[item.itemCode] || `BAR-${item.itemCode}`;
        const srcSnap = sourceStockSnaps[i];
        const srcExistingStock = srcSnap.exists() ? (srcSnap.data() as Stock) : null;

        let srcStock = calculateUpdatedStock(
          srcExistingStock,
          tr.sourceWarehouseId,
          tr.sourceWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'availableQty',
          item.qty
        );

        srcStock = calculateUpdatedStock(
          srcStock,
          tr.sourceWarehouseId,
          tr.sourceWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'inTransitQty',
          -item.qty
        );

        stockWrites.push({ ref: sourceStockDocRefs[i], data: srcStock });

        const mvtRef = doc(collection(db, 'movements'));
        movementWrites.push({
          ref: mvtRef,
          data: {
            date: dateStr,
            time: timeStr,
            itemCode: item.itemCode,
            itemName: item.itemName,
            warehouseId: tr.sourceWarehouseId,
            warehouseName: tr.sourceWarehouseName,
            qty: item.qty,
            transactionType: 'Transfer (Reversal)',
            referenceNumber: `REV-${tr.transferNumber}`,
            user,
            remarks: `REVERSAL of transfer dispatch ${tr.transferNumber} upon document removal.`
          }
        });
      }
    }

    // If status is Received or Closed
    if (tr.status === 'Received' || tr.status === 'Closed') {
      for (let i = 0; i < transferItems.length; i++) {
        const item = transferItems[i];
        const barcode = productBarcodes[item.itemCode] || `BAR-${item.itemCode}`;
        const srcSnap = sourceStockSnaps[i];
        const srcExistingStock = srcSnap.exists() ? (srcSnap.data() as Stock) : null;

        const destSnap = destStockSnaps[i];
        const destExistingStock = destSnap && destSnap.exists() ? (destSnap.data() as Stock) : null;

        const destStock = calculateUpdatedStock(
          destExistingStock,
          tr.destWarehouseId,
          tr.destWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'availableQty',
          -item.qty
        );
        stockWrites.push({ ref: destStockDocRefs[i], data: destStock });

        const srcStock = calculateUpdatedStock(
          srcExistingStock,
          tr.sourceWarehouseId,
          tr.sourceWarehouseName,
          item.itemCode,
          item.itemName,
          barcode,
          'availableQty',
          item.qty
        );
        stockWrites.push({ ref: sourceStockDocRefs[i], data: srcStock });

        const mvtDestRef = doc(collection(db, 'movements'));
        movementWrites.push({
          ref: mvtDestRef,
          data: {
            date: dateStr,
            time: timeStr,
            itemCode: item.itemCode,
            itemName: item.itemName,
            warehouseId: tr.destWarehouseId,
            warehouseName: tr.destWarehouseName,
            qty: -item.qty,
            transactionType: 'Transfer (Reversal)',
            referenceNumber: `REV-${tr.transferNumber}`,
            user,
            remarks: `REVERSAL of transfer receipt ${tr.transferNumber} upon document removal.`
          }
        });

        const mvtSrcRef = doc(collection(db, 'movements'));
        movementWrites.push({
          ref: mvtSrcRef,
          data: {
            date: dateStr,
            time: timeStr,
            itemCode: item.itemCode,
            itemName: item.itemName,
            warehouseId: tr.sourceWarehouseId,
            warehouseName: tr.sourceWarehouseName,
            qty: item.qty,
            transactionType: 'Transfer (Reversal)',
            referenceNumber: `REV-${tr.transferNumber}`,
            user,
            remarks: `REVERSAL of transfer source stock ${tr.transferNumber} upon document removal.`
          }
        });
      }
    }

    // 3. ALL WRITES
    for (const write of stockWrites) {
      transaction.set(write.ref, write.data, { merge: true });
    }
    for (const mvt of movementWrites) {
      transaction.set(mvt.ref, mvt.data);
    }
    transaction.delete(transferDocRef);

    return { success: true, transferNumber: tr.transferNumber };
  });
}

// ============================================================================
// 11. ATOMIC DIRECT MOVEMENT REVERSAL
// Writes: Compensating Reversal Movement Doc + Restored Stock Doc
// ============================================================================
export async function reverseMovementAtomic(
  db: Firestore,
  params: {
    movementId: string;
    customReason?: string;
    user: string;
    role: UserRole;
    productBarcodes?: Record<string, string>;
  }
): Promise<{ reversalMovementId: string; revRef: string }> {
  const { movementId, customReason, user, role, productBarcodes = {} } = params;
  assertSuperAdmin(role, 'reverse ledger movements');
  const mvtRef = doc(db, 'movements', movementId);

  return await runTransaction(db, async (transaction) => {
    // 1. ALL READS FIRST
    const mvtSnap = await transaction.get(mvtRef);
    if (!mvtSnap.exists()) {
      throw new Error(`Movement record ${movementId} not found.`);
    }

    const mvt = mvtSnap.data() as StockMovement;
    if (mvt.reversalOf) {
      throw new Error("A reversal movement cannot be reversed.");
    }

    const stockDocId = getStockDocId(mvt.warehouseId, mvt.itemCode);
    const stockDocRef = doc(db, 'stocks', stockDocId);
    const stockSnap = await transaction.get(stockDocRef);
    const existingStock = stockSnap.exists() ? (stockSnap.data() as Stock) : null;

    // 2. IN-MEMORY COMPUTATION
    const barcode = productBarcodes[mvt.itemCode] || `BAR-${mvt.itemCode}`;
    const absQty = Math.abs(mvt.qty);
    let updatedStock: Stock;

    const { transactionType, adjustmentType } = mvt;

    if (
      transactionType === 'Inward (GRN)' ||
      transactionType === 'Adjustment (Add)' ||
      transactionType === 'Opening Stock Balance' ||
      transactionType === 'Transfer In' ||
      adjustmentType === 'Increase' ||
      adjustmentType === 'Excess'
    ) {
      updatedStock = calculateUpdatedStock(
        existingStock,
        mvt.warehouseId,
        mvt.warehouseName,
        mvt.itemCode,
        mvt.itemName,
        barcode,
        'availableQty',
        -absQty
      );
    } else if (
      transactionType === 'Outward (Dispatch)' ||
      transactionType === 'Adjustment (Sub)' ||
      adjustmentType === 'Decrease' ||
      adjustmentType === 'Shortage'
    ) {
      updatedStock = calculateUpdatedStock(
        existingStock,
        mvt.warehouseId,
        mvt.warehouseName,
        mvt.itemCode,
        mvt.itemName,
        barcode,
        'availableQty',
        absQty
      );
    } else if (transactionType === 'Adjustment (Damage)' || adjustmentType === 'Damage') {
      let temp = calculateUpdatedStock(
        existingStock,
        mvt.warehouseId,
        mvt.warehouseName,
        mvt.itemCode,
        mvt.itemName,
        barcode,
        'availableQty',
        absQty
      );
      updatedStock = calculateUpdatedStock(
        temp,
        mvt.warehouseId,
        mvt.warehouseName,
        mvt.itemCode,
        mvt.itemName,
        barcode,
        'damagedQty',
        -absQty
      );
    } else if (transactionType === 'Transfer Out') {
      let temp = calculateUpdatedStock(
        existingStock,
        mvt.warehouseId,
        mvt.warehouseName,
        mvt.itemCode,
        mvt.itemName,
        barcode,
        'availableQty',
        absQty
      );
      updatedStock = calculateUpdatedStock(
        temp,
        mvt.warehouseId,
        mvt.warehouseName,
        mvt.itemCode,
        mvt.itemName,
        barcode,
        'inTransitQty',
        -absQty
      );
    } else {
      updatedStock = calculateUpdatedStock(
        existingStock,
        mvt.warehouseId,
        mvt.warehouseName,
        mvt.itemCode,
        mvt.itemName,
        barcode,
        'availableQty',
        -mvt.qty
      );
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString();
    const revQty = -mvt.qty;
    const revRef = `REV-${mvt.referenceNumber || movementId}`;
    const reason = customReason || `Compensating reversal for movement ${mvt.referenceNumber || movementId}`;

    const reversalMvtDocRef = doc(collection(db, 'movements'));
    const reversalMvtData: Omit<StockMovement, 'id'> = {
      date: dateStr,
      time: timeStr,
      itemCode: mvt.itemCode,
      itemName: mvt.itemName,
      warehouseId: mvt.warehouseId,
      warehouseName: mvt.warehouseName,
      qty: revQty,
      transactionType: 'Adjustment (Reversal)',
      referenceNumber: revRef,
      user,
      reversalOf: movementId,
      remarks: `REVERSAL of historical movement entry ${mvt.referenceNumber || movementId}. Restored stock balance. Reason: ${reason}`
    };

    // 3. ALL WRITES
    transaction.set(stockDocRef, updatedStock, { merge: true });
    transaction.set(reversalMvtDocRef, reversalMvtData);

    return {
      reversalMovementId: reversalMvtDocRef.id,
      revRef
    };
  });
}
