import { initializeApp } from 'firebase/app';
import { 
  initializeFirestore, 
  getFirestore, 
  collection, 
  writeBatch, 
  doc, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  getDoc as firestoreGetDoc, 
  getDocs as firestoreGetDocs, 
  getDocFromCache, 
  getDocsFromCache,
  DocumentSnapshot,
  QuerySnapshot,
  DocumentData
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// Firebase configuration with hardcoded fallback matching firebase-applet-config.json
const firebaseConfig = {
  apiKey: "AIzaSyAtt2oAKA-Npqc26e1NtGOmt9i6mf4P4Uw",
  authDomain: "third-cabinet-13bk6.firebaseapp.com",
  projectId: "third-cabinet-13bk6",
  storageBucket: "third-cabinet-13bk6.firebasestorage.app",
  messagingSenderId: "1072101912249",
  appId: "1:1072101912249:web:1bdea39356f964b0b33568",
  databaseId: "ai-studio-stockflowerp-f87c4a27-cfad-410f-8d27-f672b5338709" // custom database ID used in AI Studio
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firestore with custom databaseId, multi-tab persistent cache, and auto-detect long polling
let db: any;
try {
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  }, firebaseConfig.databaseId);
} catch (cacheError) {
  console.warn("Firestore persistent cache is not supported or was blocked by browser privacy settings. Falling back to memory cache.");
  try {
    db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true
    }, firebaseConfig.databaseId);
  } catch (secondError) {
    db = getFirestore(app, firebaseConfig.databaseId);
  }
}

// Initialize Firebase Auth
const auth = getAuth(app);

// Helper to get doc with timeout, falling back to cache
export async function getDocWithTimeout(docRef: any, timeoutMs: number = 8000): Promise<DocumentSnapshot<DocumentData, DocumentData>> {
  try {
    const cached = await getDocFromCache(docRef);
    if (cached && cached.exists()) {
      // Background sync
      firestoreGetDoc(docRef).catch(() => {});
      return cached;
    }
  } catch (_cacheErr) {
    // Cache miss or pending cache initialization
  }

  const timeoutPromise = new Promise<any>((_, reject) =>
    setTimeout(() => reject(new Error("Network timeout")), timeoutMs)
  );
  try {
    return await Promise.race([
      firestoreGetDoc(docRef),
      timeoutPromise
    ]);
  } catch (err) {
    try {
      return await getDocFromCache(docRef);
    } catch (cacheErr) {
      throw err;
    }
  }
}

// Helper to get docs with timeout, falling back to cache
export async function getDocsWithTimeout(queryRef: any, timeoutMs: number = 8000): Promise<QuerySnapshot<DocumentData, DocumentData>> {
  try {
    const cached = await getDocsFromCache(queryRef);
    if (cached && !cached.empty) {
      // Background sync
      firestoreGetDocs(queryRef).catch(() => {});
      return cached;
    }
  } catch (_cacheErr) {
    // Cache miss
  }

  const timeoutPromise = new Promise<any>((_, reject) =>
    setTimeout(() => reject(new Error("Network timeout")), timeoutMs)
  );
  try {
    return await Promise.race([
      firestoreGetDocs(queryRef),
      timeoutPromise
    ]);
  } catch (err) {
    try {
      return await getDocsFromCache(queryRef);
    } catch (cacheErr) {
      throw err;
    }
  }
}

// Export custom wrapper versions to easily prevent network blocking across the app
export { getDocWithTimeout as getDoc, getDocsWithTimeout as getDocs };

// Auto-seeding helper to ensure the app has realistic data out-of-the-box
export async function seedDatabaseIfEmpty() {
  try {
    // Check if warehouses exist in cache or server
    let warehousesSnap: QuerySnapshot<DocumentData, DocumentData> | null = null;
    try {
      warehousesSnap = await getDocsFromCache(collection(db, 'warehouses'));
    } catch (_c) {}

    if (!warehousesSnap || warehousesSnap.empty) {
      try {
        warehousesSnap = await getDocsWithTimeout(collection(db, 'warehouses'), 5000);
      } catch (_s) {}
    }

    if (warehousesSnap && !warehousesSnap.empty) {
      console.log("Database already seeded with warehouses.");
      return;
    }

    console.log("Seeding database with default mock datasets...");
    const batch = writeBatch(db);

    // 1. Warehouses
    const defaultWarehouses = [
      { id: 'WH-MUM', code: 'WH-MUM', name: 'Central Warehouse (Mumbai)', address: 'Sector-5, Kalamboli Logistics Zone', city: 'Mumbai', state: 'Maharashtra', contactPerson: 'Rajesh Sharma', phone: '+91 98200 12345', status: 'Active', isPrimary: true },
      { id: 'WH-DEL', code: 'WH-DEL', name: 'Regional Hub (Delhi)', address: 'G-12, Okhla Industrial Area Phase 3', city: 'New Delhi', state: 'Delhi', contactPerson: 'Vikram Singh', phone: '+91 98110 54321', status: 'Active', isPrimary: false },
      { id: 'WH-BLR', code: 'WH-BLR', name: 'South Tech Depot (Bengaluru)', address: 'Plot 45, Whitefield Ind. Area', city: 'Bengaluru', state: 'Karnataka', contactPerson: 'Anita Rao', phone: '+91 98450 98765', status: 'Active', isPrimary: false },
      { id: 'WH-PUN', code: 'WH-PUN', name: 'Pune Fulfillment Center', address: 'Gate 3, Hinjawadi Phase 2', city: 'Pune', state: 'Maharashtra', contactPerson: 'Rahul Patil', phone: '+91 98900 11223', status: 'Active', isPrimary: false },
      { id: 'WH-DER', code: 'WH-DER', name: 'Derabassi Warehouse', address: 'NH-22, Industrial Focal Point', city: 'Derabassi', state: 'Punjab', contactPerson: 'Harpreet Singh', phone: '+91 98765 43210', status: 'Active', isPrimary: false }
    ];
    defaultWarehouses.forEach(wh => {
      const ref = doc(db, 'warehouses', wh.id);
      batch.set(ref, wh);
    });

    // 2. Products (Fastener & Screw Inventory)
    const defaultProducts = [
      { id: 'PRD-IPH', itemCode: 'PRD-IPH', barcode: '195949033321', qrCode: 'QR_PRD-IPH', name: 'Stainless Steel Hex Head Screw (M6 x 20mm)', description: 'Grade 304 Stainless Steel Hexagon Head Machine Screw Fastener', category: 'Reliance Retail outlets', brand: 'Apex Fasteners', unit: 'Pcs', hsnCode: '73181500', gst: 18, purchaseRate: 12, sellingRate: 18, minStock: 10, maxStock: 500, weight: 0.015, image: 'https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?w=150&auto=format&fit=crop&q=60' },
      { id: 'PRD-S24', itemCode: 'PRD-S24', barcode: '8806095304381', qrCode: 'QR_PRD-S24', name: 'Self-Tapping Wood Screw (M4 x 35mm)', description: 'Zinc Plated Phillips Cross Drive Bugle Head Wood Screw', category: 'Reliance Retail outlets', brand: 'FastenPro', unit: 'Pcs', hsnCode: '73181200', gst: 18, purchaseRate: 4, sellingRate: 8, minStock: 10, maxStock: 1000, weight: 0.008, image: 'https://images.unsplash.com/photo-1508873696983-2df515122519?w=150&auto=format&fit=crop&q=60' },
      { id: 'PRD-MAC', itemCode: 'PRD-MAC', barcode: '195949111321', qrCode: 'QR_PRD-MAC', name: 'High Tensile Socket Cap Screw (M8 x 40mm)', description: 'Class 12.9 Alloy Steel Black Oxide Allen Socket Head Screw', category: 'Croma Tech Solutions', brand: 'Apex Fasteners', unit: 'Pcs', hsnCode: '73181500', gst: 18, purchaseRate: 25, sellingRate: 35, minStock: 5, maxStock: 300, weight: 0.028, image: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=150&auto=format&fit=crop&q=60' },
      { id: 'PRD-MON', itemCode: 'PRD-MON', barcode: '884116345672', qrCode: 'QR_PRD-MON', name: 'Drywall Zinc Plated Screw (3.5 x 25mm)', description: 'Coarse Thread Black Phosphate / Zinc Drywall Fastener Screw', category: 'Croma Tech Solutions', brand: 'FastenPro', unit: 'Pcs', hsnCode: '73181400', gst: 18, purchaseRate: 2, sellingRate: 5, minStock: 15, maxStock: 2000, weight: 0.005, image: 'https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?w=150&auto=format&fit=crop&q=60' },
      { id: 'PRD-KEY', itemCode: 'PRD-KEY', barcode: '097855156721', qrCode: 'QR_PRD-KEY', name: 'Brass Machine Screw Pan Head (M3 x 12mm)', description: 'Solid Brass Slotted Pan Head Machine Screw Fastener', category: 'Reliance Retail outlets', brand: 'GoldScrews', unit: 'Pcs', hsnCode: '73181500', gst: 18, purchaseRate: 6, sellingRate: 10, minStock: 15, maxStock: 800, weight: 0.004, image: 'https://images.unsplash.com/photo-1586864387789-628af9feed72?w=150&auto=format&fit=crop&q=60' }
    ];
    defaultProducts.forEach(prod => {
      const ref = doc(db, 'products', prod.id);
      batch.set(ref, prod);
    });

    // 3. Suppliers
    const defaultSuppliers = [
      { id: 'SPL-GLB', name: 'Global Screw & Fastener Distributors', gstNumber: '27AAAAA1111A1Z1', panNumber: 'AAAAA1111A', address: 'B-Block, Bandra Kurla Complex', contactPerson: 'Nitin Gadkari', phone: '+91 91111 22222', email: 'sales@globalscrews.com' },
      { id: 'SPL-ELC', name: 'Apex Fasteners & Hardware Ltd', gstNumber: '07BBBBB2222B2Z2', panNumber: 'BBBBB2222B', address: 'Industrial Area Phase-I, Noida', contactPerson: 'Sanjay Dutt', phone: '+91 92222 33333', email: 'orders@apexfasteners.in' }
    ];
    defaultSuppliers.forEach(sup => {
      const ref = doc(db, 'suppliers', sup.id);
      batch.set(ref, sup);
    });

    // 4. Customers
    const defaultCustomers = [
      { id: 'CST-RTL', name: 'Reliance Retail outlets', gstNumber: '27CCCCC3333C3Z3', address: 'Reliance Corporate Park, Navi Mumbai', phone: '+91 93333 44444', email: 'logistics@relretail.com' },
      { id: 'CST-CRO', name: 'Croma Tech Solutions', gstNumber: '29DDDDD4444D4Z4', address: 'Infinity IT Lagoon, Salt Lake, Sector V', phone: '+91 94444 55555', email: 'receiving@croma.com' }
    ];
    defaultCustomers.forEach(cust => {
      const ref = doc(db, 'customers', cust.id);
      batch.set(ref, cust);
    });

    // 5. Stocks (warehouseId_itemCode)
    const defaultStocks = [
      // Central Warehouse (WH-MUM)
      { id: 'WH-MUM_PRD-IPH', itemCode: 'PRD-IPH', barcode: '195949033321', itemName: 'Stainless Steel Hex Head Screw (M6 x 20mm)', warehouseId: 'WH-MUM', warehouseName: 'Central Warehouse (Mumbai)', availableQty: 450, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 450 },
      { id: 'WH-MUM_PRD-S24', itemCode: 'PRD-S24', barcode: '8806095304381', itemName: 'Self-Tapping Wood Screw (M4 x 35mm)', warehouseId: 'WH-MUM', warehouseName: 'Central Warehouse (Mumbai)', availableQty: 600, reservedQty: 100, inTransitQty: 0, damagedQty: 20, totalQty: 720 },
      { id: 'WH-MUM_PRD-MAC', itemCode: 'PRD-MAC', barcode: '195949111321', itemName: 'High Tensile Socket Cap Screw (M8 x 40mm)', warehouseId: 'WH-MUM', warehouseName: 'Central Warehouse (Mumbai)', availableQty: 200, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 200 },
      { id: 'WH-MUM_PRD-MON', itemCode: 'PRD-MON', barcode: '884116345672', itemName: 'Drywall Zinc Plated Screw (3.5 x 25mm)', warehouseId: 'WH-MUM', warehouseName: 'Central Warehouse (Mumbai)', availableQty: 800, reservedQty: 0, inTransitQty: 0, damagedQty: 50, totalQty: 850 },
      { id: 'WH-MUM_PRD-KEY', itemCode: 'PRD-KEY', barcode: '097855156721', itemName: 'Brass Machine Screw Pan Head (M3 x 12mm)', warehouseId: 'WH-MUM', warehouseName: 'Central Warehouse (Mumbai)', availableQty: 1100, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 1100 },

      // Regional Hub (WH-DEL)
      { id: 'WH-DEL_PRD-IPH', itemCode: 'PRD-IPH', barcode: '195949033321', itemName: 'Stainless Steel Hex Head Screw (M6 x 20mm)', warehouseId: 'WH-DEL', warehouseName: 'Regional Hub (Delhi)', availableQty: 150, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 150 },
      { id: 'WH-DEL_PRD-S24', itemCode: 'PRD-S24', barcode: '8806095304381', itemName: 'Self-Tapping Wood Screw (M4 x 35mm)', warehouseId: 'WH-DEL', warehouseName: 'Regional Hub (Delhi)', availableQty: 8, reservedQty: 0, inTransitQty: 50, damagedQty: 2, totalQty: 60 },
      { id: 'WH-DEL_PRD-MAC', itemCode: 'PRD-MAC', barcode: '195949111321', itemName: 'High Tensile Socket Cap Screw (M8 x 40mm)', warehouseId: 'WH-DEL', warehouseName: 'Regional Hub (Delhi)', availableQty: 120, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 120 },
      { id: 'WH-DEL_PRD-MON', itemCode: 'PRD-MON', barcode: '884116345672', itemName: 'Drywall Zinc Plated Screw (3.5 x 25mm)', warehouseId: 'WH-DEL', warehouseName: 'Regional Hub (Delhi)', availableQty: 250, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 250 },
      { id: 'WH-DEL_PRD-KEY', itemCode: 'PRD-KEY', barcode: '097855156721', itemName: 'Brass Machine Screw Pan Head (M3 x 12mm)', warehouseId: 'WH-DEL', warehouseName: 'Regional Hub (Delhi)', availableQty: 400, reservedQty: 0, inTransitQty: 0, damagedQty: 10, totalQty: 410 },

      // South Tech Depot (WH-BLR)
      { id: 'WH-BLR_PRD-IPH', itemCode: 'PRD-IPH', barcode: '195949033321', itemName: 'Stainless Steel Hex Head Screw (M6 x 20mm)', warehouseId: 'WH-BLR', warehouseName: 'South Tech Depot (Bengaluru)', availableQty: 5, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 5 },
      { id: 'WH-BLR_PRD-S24', itemCode: 'PRD-S24', barcode: '8806095304381', itemName: 'Self-Tapping Wood Screw (M4 x 35mm)', warehouseId: 'WH-BLR', warehouseName: 'South Tech Depot (Bengaluru)', availableQty: 120, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 120 },
      { id: 'WH-BLR_PRD-MAC', itemCode: 'PRD-MAC', barcode: '195949111321', itemName: 'High Tensile Socket Cap Screw (M8 x 40mm)', warehouseId: 'WH-BLR', warehouseName: 'South Tech Depot (Bengaluru)', availableQty: 0, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 0 },
      { id: 'WH-BLR_PRD-MON', itemCode: 'PRD-MON', barcode: '884116345672', itemName: 'Drywall Zinc Plated Screw (3.5 x 25mm)', warehouseId: 'WH-BLR', warehouseName: 'South Tech Depot (Bengaluru)', availableQty: 140, reservedQty: 0, inTransitQty: 0, damagedQty: 20, totalQty: 160 },
      { id: 'WH-BLR_PRD-KEY', itemCode: 'PRD-KEY', barcode: '097855156721', itemName: 'Brass Machine Screw Pan Head (M3 x 12mm)', warehouseId: 'WH-BLR', warehouseName: 'South Tech Depot (Bengaluru)', availableQty: 350, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 350 },

      // Pune Fulfillment Center (WH-PUN)
      { id: 'WH-PUN_PRD-IPH', itemCode: 'PRD-IPH', barcode: '195949033321', itemName: 'Stainless Steel Hex Head Screw (M6 x 20mm)', warehouseId: 'WH-PUN', warehouseName: 'Pune Fulfillment Center', availableQty: 180, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 180 },
      { id: 'WH-PUN_PRD-S24', itemCode: 'PRD-S24', barcode: '8806095304381', itemName: 'Self-Tapping Wood Screw (M4 x 35mm)', warehouseId: 'WH-PUN', warehouseName: 'Pune Fulfillment Center', availableQty: 150, reservedQty: 20, inTransitQty: 0, damagedQty: 0, totalQty: 170 },
      { id: 'WH-PUN_PRD-MAC', itemCode: 'PRD-MAC', barcode: '195949111321', itemName: 'High Tensile Socket Cap Screw (M8 x 40mm)', warehouseId: 'WH-PUN', warehouseName: 'Pune Fulfillment Center', availableQty: 60, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 60 },
      { id: 'WH-PUN_PRD-MON', itemCode: 'PRD-MON', barcode: '884116345672', itemName: 'Drywall Zinc Plated Screw (3.5 x 25mm)', warehouseId: 'WH-PUN', warehouseName: 'Pune Fulfillment Center', availableQty: 220, reservedQty: 0, inTransitQty: 0, damagedQty: 10, totalQty: 230 },
      { id: 'WH-PUN_PRD-KEY', itemCode: 'PRD-KEY', barcode: '097855156721', itemName: 'Brass Machine Screw Pan Head (M3 x 12mm)', warehouseId: 'WH-PUN', warehouseName: 'Pune Fulfillment Center', availableQty: 500, reservedQty: 0, inTransitQty: 0, damagedQty: 0, totalQty: 500 }
    ];
    defaultStocks.forEach(st => {
      const ref = doc(db, 'stocks', st.id);
      batch.set(ref, st);
    });

    // 6. Transfers
    const defaultTransfers = [
      {
        id: 'TRF-1001',
        transferNumber: 'TRF-1001',
        sourceWarehouseId: 'WH-MUM',
        sourceWarehouseName: 'Central Warehouse (Mumbai)',
        destWarehouseId: 'WH-DEL',
        destWarehouseName: 'Regional Hub (Delhi)',
        itemCode: 'PRD-S24',
        itemName: 'Self-Tapping Wood Screw (M4 x 35mm)',
        qty: 50,
        status: 'In Transit',
        createdBy: 'Arjun Mehta (Store Operator)',
        createdAt: '2026-07-01T10:30:00Z',
        approvedBy: 'Rajesh Sharma (Warehouse Manager)',
        approvedAt: '2026-07-02T14:15:00Z',
        dispatchedBy: 'Vikram Singh (Warehouse Manager)',
        dispatchedAt: '2026-07-03T09:00:00Z',
        remarks: 'Urgent screw stock requirement for Delhi region.'
      },
      {
        id: 'TRF-1002',
        transferNumber: 'TRF-1002',
        sourceWarehouseId: 'WH-MUM',
        sourceWarehouseName: 'Central Warehouse (Mumbai)',
        destWarehouseId: 'WH-BLR',
        destWarehouseName: 'South Tech Depot (Bengaluru)',
        itemCode: 'PRD-MAC',
        itemName: 'High Tensile Socket Cap Screw (M8 x 40mm)',
        qty: 100,
        status: 'Pending Approval',
        createdBy: 'Anita Rao (Warehouse Manager)',
        createdAt: '2026-07-06T16:45:00Z',
        remarks: 'Replenishing out-of-stock Socket Screws in Pcs.'
      },
      {
        id: 'TRF-1003',
        transferNumber: 'TRF-1003',
        sourceWarehouseId: 'WH-DEL',
        sourceWarehouseName: 'Regional Hub (Delhi)',
        destWarehouseId: 'WH-BLR',
        destWarehouseName: 'South Tech Depot (Bengaluru)',
        itemCode: 'PRD-KEY',
        itemName: 'Brass Machine Screw Pan Head (M3 x 12mm)',
        qty: 150,
        status: 'Closed',
        createdBy: 'Vikram Singh (Warehouse Manager)',
        createdAt: '2026-06-25T11:00:00Z',
        approvedBy: 'Rajesh Sharma (Warehouse Manager)',
        approvedAt: '2026-06-25T12:00:00Z',
        dispatchedBy: 'Vikram Singh',
        dispatchedAt: '2026-06-26T10:00:00Z',
        receivedBy: 'Anita Rao',
        receivedAt: '2026-06-28T15:30:00Z',
        remarks: 'Fulfilling retail order transfer in Pcs.'
      }
    ];
    defaultTransfers.forEach(tr => {
      const ref = doc(db, 'transfers', tr.id);
      batch.set(ref, tr);
    });

    // 7. StockMovements (Ledger)
    const defaultMovements = [
      { id: 'MVT-101', date: '2026-06-20', time: '10:15:00', itemCode: 'PRD-IPH', itemName: 'Stainless Steel Hex Head Screw (M6 x 20mm)', warehouseId: 'WH-MUM', warehouseName: 'Central Warehouse (Mumbai)', qty: 500, user: 'Rajesh Sharma', transactionType: 'Inward (GRN)', referenceNumber: 'GRN-2001', remarks: 'Initial vendor consignment' },
      { id: 'MVT-102', date: '2026-06-21', time: '14:30:00', itemCode: 'PRD-IPH', itemName: 'Stainless Steel Hex Head Screw (M6 x 20mm)', warehouseId: 'WH-MUM', warehouseName: 'Central Warehouse (Mumbai)', qty: -50, user: 'Arjun Mehta', transactionType: 'Outward (Dispatch)', referenceNumber: 'DSP-3001', remarks: 'Direct client dispatch' },
      { id: 'MVT-103', date: '2026-06-25', time: '11:00:00', itemCode: 'PRD-KEY', itemName: 'Brass Machine Screw Pan Head (M3 x 12mm)', warehouseId: 'WH-DEL', warehouseName: 'Regional Hub (Delhi)', qty: -150, user: 'Vikram Singh', transactionType: 'Transfer Out', referenceNumber: 'TRF-1003', remarks: 'Transfer to BLR' },
      { id: 'MVT-104', date: '2026-06-28', time: '15:30:00', itemCode: 'PRD-KEY', itemName: 'Brass Machine Screw Pan Head (M3 x 12mm)', warehouseId: 'WH-BLR', warehouseName: 'South Tech Depot (Bengaluru)', qty: 150, user: 'Anita Rao', transactionType: 'Transfer In', referenceNumber: 'TRF-1003', remarks: 'Received from DEL' }
    ];
    defaultMovements.forEach(mvt => {
      const ref = doc(db, 'movements', mvt.id);
      batch.set(ref, mvt);
    });

    // 8. Notifications
    const defaultNotifications = [
      { id: 'NTF-1', title: 'Low Stock Alert', message: 'Self-Tapping Wood Screw (M4 x 35mm) is below minimum stock in Regional Hub (Delhi). Current: 8 Pcs.', type: 'low_stock', status: 'unread', createdAt: '2026-07-06T09:00:00Z' },
      { id: 'NTF-2', title: 'Approval Required', message: 'Transfer request TRF-1002 requires Warehouse Manager approval.', type: 'approval_required', status: 'unread', createdAt: '2026-07-06T16:46:00Z' },
      { id: 'NTF-3', title: 'Out of Stock Alert', message: 'High Tensile Socket Cap Screw (M8 x 40mm) is completely out of stock in South Tech Depot (Bengaluru).', type: 'out_of_stock', status: 'read', createdAt: '2026-07-05T12:00:00Z' }
    ];
    defaultNotifications.forEach(ntf => {
      const ref = doc(db, 'notifications', ntf.id);
      batch.set(ref, ntf);
    });

    // 9. Audit Logs
    const defaultAuditLogs = [
      { id: 'LOG-1', date: '2026-07-01', time: '09:00:00', user: 'System', action: 'Database Seeded', module: 'System Master', details: 'Preloaded default master warehouses, screw products in Pcs, suppliers, customers, and active stock levels.' },
      { id: 'LOG-2', date: '2026-07-01', time: '10:30:00', user: 'Arjun Mehta', action: 'Create Transfer Request', module: 'Warehouse Transfer', details: 'Created TRF-1001 for 50 Pcs of PRD-S24 from WH-MUM to WH-DEL' }
    ];
    defaultAuditLogs.forEach(logEntry => {
      const ref = doc(db, 'auditLogs', logEntry.id);
      batch.set(ref, logEntry);
    });

    await batch.commit();
    console.log("Database seeded successfully with default items!");
  } catch (error) {
    console.error("Error seeding Firestore database: ", error);
  }
}

export { db, auth };
export default app;
