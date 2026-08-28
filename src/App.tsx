import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  setDoc,
  query,
  where,
  deleteDoc
} from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth, getDoc, getDocs } from './firebase';
import {
  UserRole,
  User,
  Warehouse,
  Product,
  Stock,
  Inward,
  Outward,
  Transfer,
  StockMovement,
  AuditLog,
  Supplier,
  Customer,
  OfflineTransaction,
  Notification,
  InventoryException,
  ReconciliationReportSummary,
  isDerabassi,
  getLiveAvailableQty
} from './types';
import { rearrangeDispatchSeries, rearrangeTransferSeries } from './utils/seriesUtils';
import { 
  runInventoryReconciliation, 
  resolveInventoryException, 
  markExceptionUnderReview 
} from './utils/reconciliationService';
import { runIdempotent, IdempotencyKeys, isTransactionCompleted } from './utils/idempotency';
import {
  postInwardAtomic,
  postOutwardAtomic,
  updateTransferStatusAtomic,
  undoTransferAtomic,
  postStockAdjustmentAtomic,
  revertStockAdjustmentAtomic,
  addProductWithInitialStockAtomic,
  deleteInwardAtomic,
  deleteOutwardAtomic,
  deleteTransferAtomic,
  reverseMovementAtomic,
  getStockDocId
} from './utils/atomicStockTransactions';
import {
  Layers,
  Warehouse as WhIcon,
  ShoppingBag,
  Inbox,
  ArrowLeftRight,
  ClipboardList,
  Wrench,
  BarChart,
  UserCheck,
  Building,
  QrCode,
  ShieldCheck,
  CheckCircle,
  Menu,
  X,
  LogOut,
  Users,
  Send,
  TrendingUp,
  RefreshCw,
  CloudOff,
  Cloud,
  Wifi,
  WifiOff,
  AlertCircle,
  Bell,
  Check,
  Trash2
} from 'lucide-react';

import { DashboardView } from './components/views/DashboardView';
import { WarehouseView } from './components/views/WarehouseView';
import { ProductView } from './components/views/ProductView';
import { StockView } from './components/views/StockView';
import { TransferView } from './components/views/TransferView';
import { StockLedgerView } from './components/views/StockLedgerView';
import { StockAdjustmentView } from './components/views/StockAdjustmentView';
import { ReportsView } from './components/views/ReportsView';
import { StockReportView } from './components/views/StockReportView';
import { CustomerView } from './components/views/CustomerView';
import { CustomerDispatchView } from './components/views/CustomerDispatchView';
import { SettingsView } from './components/views/SettingsView';
import { ThemeToggle } from './components/ThemeToggle';
import { LoginScreen } from './components/LoginScreen';
import stockflowLogo from './assets/images/stockflow_logo_1783944743908.jpg';

export default function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(true);
  const [notificationOpen, setNotificationOpen] = useState(false);

  // Global Interface Theme State with Smooth Cross-Fade Transition
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('stockflow_theme') as 'light' | 'dark') || 'light';
  });

  const handleToggleTheme = (nextTheme: 'light' | 'dark') => {
    if (theme === nextTheme) return;

    const applyThemeChange = () => {
      setTheme(nextTheme);
      if (typeof document !== 'undefined') {
        if (nextTheme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
      localStorage.setItem('stockflow_theme', nextTheme);
    };

    const hasDoc = typeof document !== 'undefined';
    if (hasDoc && 'startViewTransition' in document) {
      document.documentElement.classList.add('theme-transitioning');
      try {
        const transition = (document as any).startViewTransition(() => {
          applyThemeChange();
        });
        if (transition && transition.finished) {
          transition.finished.finally(() => {
            document.documentElement.classList.remove('theme-transitioning');
          });
        } else {
          setTimeout(() => {
            document.documentElement.classList.remove('theme-transitioning');
          }, 450);
        }
      } catch {
        applyThemeChange();
        setTimeout(() => {
          document.documentElement.classList.remove('theme-transitioning');
        }, 450);
      }
    } else if (hasDoc) {
      document.documentElement.classList.add('theme-transitioning');
      applyThemeChange();
      setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
      }, 450);
    } else {
      applyThemeChange();
    }
  };

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('stockflow_theme', theme);
  }, [theme]);

  // User & Warehouse Security Context (Proper Firebase Auth integration with high-fidelity fallback)
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [currentRole, setCurrentRole] = useState<UserRole>('Store Operator');
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>('WH-MUM');
  const [currentUserName, setCurrentUserName] = useState<string>('Authorized Operator');
  const [currentUserUid, setCurrentUserUid] = useState<string>('');
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);

  // Online / Offline Network Status tracking with Simulated Offline Mode
  const [isForceOffline, setIsForceOffline] = useState<boolean>(() => {
    return localStorage.getItem('stockflow_force_offline') === 'true';
  });
  const [authErrorMessage, setAuthErrorMessage] = useState<string>('');
  const [browserOnline, setBrowserOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isOnline = browserOnline && !isForceOffline;

  const toggleForceOffline = () => {
    const newValue = !isForceOffline;
    setIsForceOffline(newValue);
    localStorage.setItem('stockflow_force_offline', newValue ? 'true' : 'false');
    logAudit(
      newValue ? 'Toggle Force Offline Mode ON' : 'Toggle Force Offline Mode OFF',
      'System Settings',
      newValue ? 'App disconnected from network' : 'App connected back to network'
    );
  };

  // Authenticate session reactivity
  useEffect(() => {
    // 1. Immediately check if we have an active local session fallback
    const localSessionStr = sessionStorage.getItem('stockflow_local_session');
    if (localSessionStr) {
      try {
        const localSession = JSON.parse(localSessionStr);
        setCurrentUserName(localSession.name || 'Authorized Operator');
        setCurrentRole(localSession.role || 'Super Admin');
        setCurrentWarehouseId(localSession.warehouseId || 'WH-MUM');
        setCurrentUserUid(localSession.uid || 'terminal-session');
        setIsLoggedIn(true);
        setIsLoadingAuth(false);
      } catch (e) {
        console.error("Failed to parse local session:", e);
      }
    }

    let unsubUserDoc: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up previous user profile listener if it exists
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }

      if (firebaseUser) {
        setCurrentUserUid(firebaseUser.uid);
        
        // Listen to user profile document in real-time
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        unsubUserDoc = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            const userData = docSnap.data() as User;
            
            // Server-enforced account status check
            if (userData.status === 'Disabled') {
              signOut(auth).then(() => {
                sessionStorage.removeItem('stockflow_local_session');
                setIsLoggedIn(false);
                setCurrentUserUid('');
                setAuthErrorMessage("Access Denied: This user account is disabled. Please contact a Super Administrator.");
                setIsLoadingAuth(false);
              });
              return;
            }

            const activeRole = userData.role;
            if (
              activeRole !== 'Super Admin' &&
              activeRole !== 'Store Operator' &&
              activeRole !== 'Viewer'
            ) {
              signOut(auth).then(() => {
                sessionStorage.removeItem('stockflow_local_session');
                setIsLoggedIn(false);
                setCurrentUserUid('');
                setAuthErrorMessage("Access Denied: Your user profile has no valid role assigned.");
                setIsLoadingAuth(false);
              });
              return;
            }

            setCurrentUserName(userData.name || firebaseUser.email || 'Authorized Operator');
            setCurrentRole(activeRole);
            setCurrentWarehouseId(userData.warehouseId || 'WH-MUM');
            setIsLoggedIn(true);
            setAuthErrorMessage('');
          } else {
            // Revoke access if no profile exists
            signOut(auth).then(() => {
              sessionStorage.removeItem('stockflow_local_session');
              setIsLoggedIn(false);
              setCurrentUserUid('');
              setAuthErrorMessage("Access Denied: No authorized user profile exists for this account. Please contact a Super Administrator.");
            }).catch((e) => {
              console.error("Auto-logout failed:", e);
            });
          }
          setIsLoadingAuth(false);
        }, (err) => {
          console.error("Error reading user profile doc:", err);
          setIsLoadingAuth(false);
        });
      } else {
        const activeLocal = sessionStorage.getItem('stockflow_local_session');
        if (!activeLocal) {
          setIsLoggedIn(false);
          setCurrentUserUid('');
        }
        setIsLoadingAuth(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubUserDoc) {
        unsubUserDoc();
      }
    };
  }, []);

  const handleLocalLogin = (name: string, role: UserRole, warehouseId: string) => {
    setCurrentUserName(name);
    setCurrentRole(role);
    setCurrentWarehouseId(warehouseId);
    setCurrentUserUid('terminal-session');
    setIsLoggedIn(true);
    sessionStorage.setItem('stockflow_local_session', JSON.stringify({ name, role, warehouseId, uid: 'terminal-session' }));
    logAudit('User Terminal Authenticated', 'Access Gatekeeper', `Session active: ${name} (${role}) assigned to ${warehouseId}`);
  };

  const handleLogout = async () => {
    logAudit('User Terminal Logout', 'Access Gatekeeper', `Logged out from Warehouse Terminal ${currentWarehouseId}`);
    sessionStorage.removeItem('stockflow_local_session');
    setIsLoggedIn(false);
    setCurrentUserUid('');
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Firebase logout failed:", err);
    }
  };

  // Real-time Database Collections State with Offline Cache Initializers
  const [warehouses, setWarehouses] = useState<Warehouse[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_warehouses');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_products');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [stocks, setStocks] = useState<Stock[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_stocks');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [inwards, setInwards] = useState<Inward[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_inwards');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [outwards, setOutwards] = useState<Outward[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_outwards');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [transfers, setTransfers] = useState<Transfer[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_transfers');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [movements, setMovements] = useState<StockMovement[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_movements');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_auditLogs');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_suppliers');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [customers, setCustomers] = useState<Customer[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_customers');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [users, setUsers] = useState<User[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_notifications');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [exceptions, setExceptions] = useState<InventoryException[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_cache_exceptions');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [lastReconciliationReport, setLastReconciliationReport] = useState<ReconciliationReportSummary | null>(null);

  const [hasSelfHealed, setHasSelfHealed] = useState(false);

  const [alertsAlignment, setAlertsAlignment] = useState<{
    inwardPhone: string;
    inwardContact: string;
    outwardPhone: string;
    outwardContact: string;
    transferPhone: string;
    transferContact: string;
    adjustmentPhone: string;
    adjustmentContact: string;
  } | null>(null);

  // Automatic Non-destructive Stock & Discrepancy audit on startup
  useEffect(() => {
    if (isOnline && products.length > 0 && warehouses.length > 0 && !hasSelfHealed) {
      setHasSelfHealed(true);
      runInventoryReconciliation(db, {
        currentUserName: currentUserName || 'System Auditor',
        currentUserRole: currentRole || 'Super Admin'
      })
        .then((report) => {
          setLastReconciliationReport(report);
          if (report.discrepancyCount > 0 || report.negativeStockCount > 0 || report.orphanCount > 0) {
            console.warn(`[Stockflow Audit] Discrepancies detected during boot audit: ${report.discrepancyCount} balance mismatches, ${report.negativeStockCount} negative stock, ${report.orphanCount} orphans. Exceptions logged.`);
          }
        })
        .catch(err => console.error("Database reconciliation audit on boot failed:", err));
    }
  }, [isOnline, products, warehouses, hasSelfHealed]);



  // Load Real-time listeners
  useEffect(() => {
    const handleErr = (err: any) => {
      console.warn("Firestore subscription connection status:", err?.message || err);
    };

    const unsubWh = onSnapshot(collection(db, 'warehouses'), (snap) => {
      const list: Warehouse[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Warehouse));
      setWarehouses(list);
      localStorage.setItem('stockflow_cache_warehouses', JSON.stringify(list));
    }, handleErr);

    const unsubProd = onSnapshot(collection(db, 'products'), (snap) => {
      const list: Product[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Product));
      setProducts(list);
      localStorage.setItem('stockflow_cache_products', JSON.stringify(list));
    }, handleErr);

    const unsubStock = onSnapshot(collection(db, 'stocks'), (snap) => {
      const list: Stock[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Stock));
      setStocks(list);
      localStorage.setItem('stockflow_cache_stocks', JSON.stringify(list));
    }, handleErr);

    const unsubIn = onSnapshot(collection(db, 'inwards'), (snap) => {
      const list: Inward[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Inward));
      setInwards(list);
      localStorage.setItem('stockflow_cache_inwards', JSON.stringify(list));
    }, handleErr);

    const unsubOut = onSnapshot(collection(db, 'outwards'), (snap) => {
      const list: Outward[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Outward));
      setOutwards(list);
      localStorage.setItem('stockflow_cache_outwards', JSON.stringify(list));
    }, handleErr);

    const unsubTr = onSnapshot(collection(db, 'transfers'), (snap) => {
      const list: Transfer[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Transfer));
      setTransfers(list);
      localStorage.setItem('stockflow_cache_transfers', JSON.stringify(list));
    }, handleErr);

    const unsubMov = onSnapshot(collection(db, 'movements'), (snap) => {
      const list: StockMovement[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as StockMovement));
      setMovements(list);
      localStorage.setItem('stockflow_cache_movements', JSON.stringify(list));
    }, handleErr);

    const unsubAud = onSnapshot(collection(db, 'auditLogs'), (snap) => {
      const list: AuditLog[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as AuditLog));
      setAuditLogs(list);
      localStorage.setItem('stockflow_cache_auditLogs', JSON.stringify(list));
    }, handleErr);

    const unsubSup = onSnapshot(collection(db, 'suppliers'), (snap) => {
      const list: Supplier[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Supplier));
      setSuppliers(list);
      localStorage.setItem('stockflow_cache_suppliers', JSON.stringify(list));
    }, handleErr);

    const unsubCust = onSnapshot(collection(db, 'customers'), (snap) => {
      const list: Customer[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Customer));
      setCustomers(list);
      localStorage.setItem('stockflow_cache_customers', JSON.stringify(list));
    }, handleErr);

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      const list: User[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({ uid: d.id, ...data } as User);
      });
      setUsers(list);
    }, handleErr);

    const unsubNtf = onSnapshot(collection(db, 'notifications'), (snap) => {
      const list: Notification[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Notification));
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setNotifications(list);
      localStorage.setItem('stockflow_cache_notifications', JSON.stringify(list));
    }, handleErr);

    const unsubExceptions = onSnapshot(collection(db, 'inventoryExceptions'), (snap) => {
      const list: InventoryException[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as InventoryException));
      list.sort((a, b) => new Date(b.detectedAt || 0).getTime() - new Date(a.detectedAt || 0).getTime());
      setExceptions(list);
      localStorage.setItem('stockflow_cache_exceptions', JSON.stringify(list));
    }, handleErr);

    const unsubAlerts = onSnapshot(doc(db, 'settings', 'alerts_alignment'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setAlertsAlignment({
          inwardPhone: data.inwardPhone || '',
          inwardContact: data.inwardContact || '',
          outwardPhone: data.outwardPhone || '',
          outwardContact: data.outwardContact || '',
          transferPhone: data.transferPhone || '',
          transferContact: data.transferContact || '',
          adjustmentPhone: data.adjustmentPhone || '',
          adjustmentContact: data.adjustmentContact || '',
        });
      }
    }, handleErr);

    return () => {
      unsubWh();
      unsubProd();
      unsubStock();
      unsubIn();
      unsubOut();
      unsubTr();
      unsubMov();
      unsubAud();
      unsubSup();
      unsubCust();
      unsubUsers();
      unsubNtf();
      unsubExceptions();
      unsubAlerts();
    };
  }, []);

  // Utility to write an audit log
  const logAudit = async (action: string, module: string, details: string) => {
    try {
      const logId = `AUD-${Date.now()}-${Math.floor(Math.random() * 1000000000)}`;
      await setDoc(doc(db, 'auditLogs', logId), {
        id: logId,
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString(),
        user: `${currentUserName || 'Super Admin'} (${currentRole})`,
        action,
        module,
        details
      });
    } catch (err) {
      console.error('Failed to log security audit trace:', err);
    }
  };

  // Real-time Notification Dispatcher and Controllers
  const sendNotification = async (
    title: string,
    message: string,
    type: Notification['type'],
    phone?: string,
    contactPerson?: string,
    roleName?: string
  ) => {
    try {
      const ntfId = `NTF-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
      
      // Look up primary aligned recipient based on notification type
      let finalPhone = phone;
      let finalContact = contactPerson;
      let finalRole = roleName;

      if (alertsAlignment) {
        if (type === 'received' && alertsAlignment.inwardPhone) {
          finalPhone = alertsAlignment.inwardPhone;
          finalContact = alertsAlignment.inwardContact;
          finalRole = 'Aligned Inward Contact';
        } else if (type === 'transaction' && alertsAlignment.outwardPhone) {
          finalPhone = alertsAlignment.outwardPhone;
          finalContact = alertsAlignment.outwardContact;
          finalRole = 'Aligned Outward Contact';
        } else if (type === 'pending_transfer' && alertsAlignment.transferPhone) {
          finalPhone = alertsAlignment.transferPhone;
          finalContact = alertsAlignment.transferContact;
          finalRole = 'Aligned Transfer Contact';
        } else if (type === 'adjustment' && alertsAlignment.adjustmentPhone) {
          finalPhone = alertsAlignment.adjustmentPhone;
          finalContact = alertsAlignment.adjustmentContact;
          finalRole = 'Aligned Adjustment Contact';
        }
      }

      const newNtf: Notification = {
        id: ntfId,
        title,
        message,
        type,
        status: 'unread',
        createdAt: new Date().toISOString(),
        ...(finalPhone && { phone: finalPhone }),
        ...(finalContact && { contactPerson: finalContact }),
        ...(finalRole && { roleName: finalRole })
      };
      await setDoc(doc(db, 'notifications', ntfId), newNtf);
    } catch (err) {
      console.error('Failed to dispatch notification:', err);
    }
  };

  const handleMarkNotificationAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { status: 'read' });
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const handleMarkAllNotificationsAsRead = async () => {
    try {
      const unreadList = notifications.filter(n => n.status === 'unread');
      const promises = unreadList.map(n => {
        if (n.id) {
          return updateDoc(doc(db, 'notifications', n.id), { status: 'read' });
        }
        return Promise.resolve();
      });
      await Promise.all(promises);
    } catch (err) {
      console.error('Failed to clear unread notifications:', err);
    }
  };

  const handleDeleteNotification = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'notifications', id));
    } catch (err) {
      console.error('Failed to purge notification:', err);
    }
  };



  // ----------------------------------------------------
  // OFFLINE TRANSACTION QUEUE & AUTO-SYNC ENGINE
  // ----------------------------------------------------
  const [offlineQueue, setOfflineQueue] = useState<OfflineTransaction[]>(() => {
    try {
      const raw = localStorage.getItem('stockflow_offline_queue');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Background / Foreground Sync Loop
  const syncPendingTransactions = useCallback(async () => {
    if (offlineQueue.length === 0 || isSyncing) return;
    setIsSyncing(true);
    setSyncError(null);

    const queueToProcess = [...offlineQueue];
    console.log(`Starting background sync of ${queueToProcess.length} pending offline transactions...`);

    try {
      for (const tx of queueToProcess) {
        const { type, payload } = tx;

        if (type === 'ADD_INWARD') {
          const key = IdempotencyKeys.inward(payload.grnNumber, payload.itemCode);
          await runIdempotent(key, async () => {
            const prod = products.find(p => p.itemCode === payload.itemCode);
            const barcode = prod ? prod.barcode : `BAR-${payload.itemCode}`;
            await postInwardAtomic(db, payload, barcode, currentRole);
            await logAudit('Post GRN Document (Synced)', 'Material Inward', `GRN: ${payload.grnNumber}, Qty: ${payload.qty} of ${payload.itemCode}`);
          });
        }

        else if (type === 'ADD_OUTWARD') {
          const key = IdempotencyKeys.outward(payload.dispatchNumber, payload.itemCode);
          await runIdempotent(key, async () => {
            const prod = products.find(p => p.itemCode === payload.itemCode);
            const barcode = prod ? prod.barcode : `BAR-${payload.itemCode}`;
            await postOutwardAtomic(db, payload, barcode, currentRole);
            await logAudit('Post Dispatch Outward (Synced)', 'Material Outward', `DSP: ${payload.dispatchNumber}${payload.invoiceNumber && payload.invoiceNumber !== 'N/A' ? `, Inv: ${payload.invoiceNumber}` : ''}, Qty: -${payload.qty} of ${payload.itemCode}`);
          });
        }

        else if (type === 'ADD_TRANSFER') {
          const key = IdempotencyKeys.transferCreate(payload.transferNumber);
          await runIdempotent(key, async () => {
            const existingTrQuery = query(collection(db, 'transfers'), where('transferNumber', '==', payload.transferNumber));
            const existingTrSnap = await getDocs(existingTrQuery);
            if (!existingTrSnap.empty) {
              console.log(`[Offline Sync] Transfer ${payload.transferNumber} already recorded. Skipping duplicate.`);
              return;
            }
            await addDoc(collection(db, 'transfers'), payload);
            await logAudit('Draft Transfer Request (Synced)', 'Inter-Warehouse Transfer', `No: ${payload.transferNumber}, Source: ${payload.sourceWarehouseId} -> Dest: ${payload.destWarehouseId}`);
          });
        }

        else if (type === 'UPDATE_TRANSFER_STATUS') {
          const { id, nextStatus, remarks, receiptDetails } = payload;
          const key = IdempotencyKeys.transferStatus(id, nextStatus);
          await runIdempotent(key, async () => {
            const barcodeMap: Record<string, string> = {};
            products.forEach(p => { barcodeMap[p.itemCode] = p.barcode; });

            const res = await updateTransferStatusAtomic(db, {
              id,
              nextStatus,
              user: `${currentRole} Operator (Synced)`,
              currentRole,
              remarks,
              receiptDetails,
              productBarcodes: barcodeMap
            });

            await logAudit(
              `Transition Transfer status (Synced)`,
              'Inter-Warehouse Transfer',
              `ID: ${id}, Shifted: ${res.oldStatus} ➔ ${res.nextStatus}`
            );
          });
        }

        else if (type === 'POST_ADJUSTMENT') {
          const adj = payload;
          const adjKey = adj.idempotencyKey || tx.id || `ADJ-${adj.itemCode}-${adj.warehouseId}-${tx.timestamp}`;
          const key = IdempotencyKeys.adjustment(adjKey);
          await runIdempotent(key, async () => {
            const warehouse = warehouses.find(w => w.code === adj.warehouseId);
            const prod = products.find(p => p.itemCode === adj.itemCode);
            if (warehouse && prod) {
              const res = await postStockAdjustmentAtomic(db, {
                itemCode: adj.itemCode,
                itemName: prod.name,
                warehouseId: adj.warehouseId,
                warehouseName: warehouse.name,
                barcode: prod.barcode,
                type: adj.type,
                qty: adj.qty,
                reason: adj.reason,
                remarks: `[Offline Synced] ${adj.remarks || ''}`,
                user: `${currentRole} Operator (Synced)`,
                role: currentRole
              });

              await logAudit('Manual Stock Adjustment (Synced)', 'Stock Adjustment', `ADJ No: ${res.overrideDocNo}, Item: ${adj.itemCode}, Qty: ${adj.qty} in WH: ${adj.warehouseId}`);
            }
          });
        }

        else if (type === 'REVERT_ADJUSTMENT') {
          const { adjustmentIdOrRef, reason } = payload;
          const key = IdempotencyKeys.adjustmentRevert(adjustmentIdOrRef);
          await runIdempotent(key, async () => {
            const barcodeMap: Record<string, string> = {};
            products.forEach(p => { barcodeMap[p.itemCode] = p.barcode; });

            const res = await revertStockAdjustmentAtomic(db, {
              originalMovementId: adjustmentIdOrRef,
              reason: `[Offline Synced REVERSAL] ${reason}`,
              user: `${currentRole} Operator (Synced)`,
              role: currentRole,
              productBarcodes: barcodeMap
            });

            await logAudit('Revert Stock Adjustment (Synced)', 'Stock Adjustment', `Reverted adjustment ${adjustmentIdOrRef} (${res.revRef}). Balance restored.`);
          });
        }

        else if (type === 'ADD_PRODUCT') {
          const { restProd, openingStock, openingWarehouseId } = payload;
          const key = IdempotencyKeys.product(restProd.itemCode);
          await runIdempotent(key, async () => {
            const targetWh = warehouses.find(w => w.id === openingWarehouseId || w.code === openingWarehouseId);
            const whName = targetWh ? targetWh.name : 'Unknown Warehouse';
            await addProductWithInitialStockAtomic(db, {
              product: restProd,
              openingStock,
              openingWarehouseId: targetWh?.id || openingWarehouseId,
              warehouseName: whName,
              user: currentUserName || `${currentRole} Operator`,
              role: currentRole
            });

            await logAudit('Create SKU Product (Synced)', 'Product Catalog', `SKU: ${restProd.itemCode}, Title: ${restProd.name}`);
            if (openingStock && openingStock > 0 && openingWarehouseId) {
              await logAudit('Initial Opening Stock (Synced)', 'Product Catalog', `SKU: ${restProd.itemCode}, Warehouse: ${whName}, Qty: ${openingStock}`);
            }
          });
        }

        else if (type === 'ADD_WAREHOUSE') {
          const wh = payload;
          const key = IdempotencyKeys.warehouse(wh.code);
          await runIdempotent(key, async () => {
            const whCheckQuery = query(collection(db, 'warehouses'), where('code', '==', wh.code));
            const whCheckSnap = await getDocs(whCheckQuery);
            if (whCheckSnap.empty) {
              if (wh.isPrimary) {
                for (const w of warehouses) {
                  if (w.isPrimary && w.id) {
                    await updateDoc(doc(db, 'warehouses', w.id), { isPrimary: false });
                  }
                }
              }
              await addDoc(collection(db, 'warehouses'), wh);
              await logAudit('Create Warehouse Profile (Synced)', 'Warehouse Setup', `Code: ${wh.code} (${wh.isPrimary ? 'Primary' : 'Secondary'})`);
            }
          });
        }

        else if (type === 'ADD_CUSTOMER') {
          const cust = payload;
          const key = IdempotencyKeys.customer(cust.name, cust.phone);
          await runIdempotent(key, async () => {
            const custCheckQuery = query(collection(db, 'customers'), where('name', '==', cust.name));
            const custCheckSnap = await getDocs(custCheckQuery);
            if (custCheckSnap.empty) {
              await addDoc(collection(db, 'customers'), cust);
              await logAudit('Register Customer Master (Synced)', 'Masters Settings', `Account: ${cust.name}`);
            }
          });
        }

        else if (type === 'ADD_SUPPLIER') {
          const sup = payload;
          const key = IdempotencyKeys.supplier(sup.name, sup.phone);
          await runIdempotent(key, async () => {
            const supCheckQuery = query(collection(db, 'suppliers'), where('name', '==', sup.name));
            const supCheckSnap = await getDocs(supCheckQuery);
            if (supCheckSnap.empty) {
              await addDoc(collection(db, 'suppliers'), sup);
              await logAudit('Register Supplier Master (Synced)', 'Masters Settings', `Vendor: ${sup.name}`);
            }
          });
        }
      }

      setOfflineQueue([]);
      localStorage.setItem('stockflow_offline_queue', JSON.stringify([]));
      console.log('Sync of all offline transactions completed successfully!');
    } catch (err: any) {
      console.error('Failed to sync offline queue:', err);
      setSyncError(err.message || 'Firestore Write Blocked');
    } finally {
      setIsSyncing(false);
    }
  }, [offlineQueue, isSyncing, db, products, warehouses, currentRole, currentUserName]);

  // Synchronize when connection is restored
  useEffect(() => {
    if (isOnline && offlineQueue.length > 0) {
      syncPendingTransactions();
    }
  }, [isOnline, offlineQueue.length, syncPendingTransactions]);

  // Optimistic Derived State Calculations to overlay pending offline mutations on active UI datasets
  const {
    derivedInwards,
    derivedOutwards,
    derivedTransfers,
    derivedMovements,
    derivedStocks,
    derivedAuditLogs,
    derivedProducts,
    derivedCustomers,
    derivedSuppliers,
    derivedWarehouses
  } = useMemo(() => {
    let tempInwards = [...inwards];
    let tempOutwards = [...outwards];
    let tempTransfers = [...transfers];
    let tempMovements = [...movements];
    let tempStocks = [...stocks];
    let tempAuditLogs = [...auditLogs];
    let tempProducts = [...products];
    let tempCustomers = [...customers];
    let tempSuppliers = [...suppliers];
    let tempWarehouses = [...warehouses];

    const localUpdateStockBalance = (
      whId: string,
      whName: string,
      itemCode: string,
      itemName: string,
      qtyChange: number,
      barcode: string,
      field: 'availableQty' | 'reservedQty' | 'inTransitQty' | 'damagedQty'
    ) => {
      const idx = tempStocks.findIndex(s => s.warehouseId === whId && s.itemCode === itemCode);
      if (idx > -1) {
        const s = { ...tempStocks[idx] };
        s[field] = (s[field] || 0) + qtyChange;
        s.totalQty = (s.availableQty || 0) + (s.reservedQty || 0) + (s.inTransitQty || 0) + (s.damagedQty || 0);
        tempStocks[idx] = s;
      } else {
        const newStock: Stock = {
          id: `${whId}_${itemCode}`,
          warehouseId: whId,
          warehouseName: whName,
          itemCode,
          itemName,
          barcode,
          availableQty: field === 'availableQty' ? qtyChange : 0,
          reservedQty: field === 'reservedQty' ? qtyChange : 0,
          inTransitQty: field === 'inTransitQty' ? qtyChange : 0,
          damagedQty: field === 'damagedQty' ? qtyChange : 0,
          totalQty: qtyChange
        };
        tempStocks.push(newStock);
      }
    };

    offlineQueue.forEach((tx) => {
      const { type, payload } = tx;

      if (type === 'ADD_INWARD') {
        const inward = payload;
        if (!tempInwards.some(i => i.grnNumber === inward.grnNumber)) {
          tempInwards.push({ id: tx.id, ...inward });

          const prod = tempProducts.find(p => p.itemCode === inward.itemCode);
          const barcode = prod ? prod.barcode : `BAR-${inward.itemCode}`;
          localUpdateStockBalance(
            inward.warehouseId,
            inward.warehouseName,
            inward.itemCode,
            inward.itemName,
            inward.qty,
            barcode,
            'availableQty'
          );

          tempMovements.push({
            id: `mov-${tx.id}`,
            date: inward.date,
            time: new Date(tx.timestamp).toLocaleTimeString(),
            itemCode: inward.itemCode,
            itemName: inward.itemName,
            warehouseId: inward.warehouseId,
            warehouseName: inward.warehouseName,
            qty: inward.qty,
            transactionType: 'Inward (GRN)',
            referenceNumber: inward.grnNumber,
            user: `${currentRole} Operator`,
            remarks: `[Offline Pending] Posted via supplier invoice ${inward.invoiceNumber}. Batch: ${inward.batchNumber}. ${inward.remarks}`
          });

          tempAuditLogs.push({
            id: `aud-${tx.id}`,
            date: inward.date,
            time: new Date(tx.timestamp).toLocaleTimeString(),
            user: `${currentRole} Operator`,
            action: 'Post GRN Document (Offline)',
            module: 'Material Inward',
            details: `[Offline Pending] GRN: ${inward.grnNumber}, Qty: ${inward.qty} of ${inward.itemCode}`
          });
        }
      }

      else if (type === 'ADD_OUTWARD') {
        const outward = payload;
        if (!tempOutwards.some(o => o.dispatchNumber === outward.dispatchNumber)) {
          tempOutwards.push({ id: tx.id, ...outward });

          const prod = tempProducts.find(p => p.itemCode === outward.itemCode);
          const barcode = prod ? prod.barcode : `BAR-${outward.itemCode}`;
          localUpdateStockBalance(
            outward.warehouseId,
            outward.warehouseName,
            outward.itemCode,
            outward.itemName,
            -outward.qty,
            barcode,
            'availableQty'
          );

          tempMovements.push({
            id: `mov-${tx.id}`,
            date: outward.date,
            time: new Date(tx.timestamp).toLocaleTimeString(),
            itemCode: outward.itemCode,
            itemName: outward.itemName,
            warehouseId: outward.warehouseId,
            warehouseName: outward.warehouseName,
            qty: -outward.qty,
            transactionType: 'Outward (Dispatch)',
            referenceNumber: outward.dispatchNumber,
            user: `${currentRole} Operator`,
            remarks: `[Offline Pending] Dispatched via vehicle ${outward.vehicleNumber}. Carrier: ${outward.transportName}.${outward.invoiceNumber && outward.invoiceNumber !== 'N/A' ? ` Invoice No: ${outward.invoiceNumber}.` : ''} ${outward.remarks}`
          });

          tempAuditLogs.push({
            id: `aud-${tx.id}`,
            date: outward.date,
            time: new Date(tx.timestamp).toLocaleTimeString(),
            user: `${currentRole} Operator`,
            action: 'Post Dispatch Outward (Offline)',
            module: 'Material Outward',
            details: `[Offline Pending] DSP: ${outward.dispatchNumber}, Qty: -${outward.qty} of ${outward.itemCode}`
          });
        }
      }

      else if (type === 'ADD_TRANSFER') {
        const tr = payload;
        if (!tempTransfers.some(t => t.transferNumber === tr.transferNumber)) {
          tempTransfers.push({ id: tx.id, ...tr });

          tempAuditLogs.push({
            id: `aud-${tx.id}`,
            date: new Date(tx.timestamp).toISOString().slice(0, 10),
            time: new Date(tx.timestamp).toLocaleTimeString(),
            user: `${currentRole} Operator`,
            action: 'Draft Transfer Request (Offline)',
            module: 'Inter-Warehouse Transfer',
            details: `[Offline Pending] No: ${tr.transferNumber}, Source: ${tr.sourceWarehouseId} -> Dest: ${tr.destWarehouseId}`
          });
        }
      }

      else if (type === 'UPDATE_TRANSFER_STATUS') {
        const { id, nextStatus, remarks } = payload;
        const transferIdx = tempTransfers.findIndex(t => t.id === id);
        if (transferIdx > -1) {
          const tr = { ...tempTransfers[transferIdx] };
          const oldStatus = tr.status;
          tr.status = nextStatus;
          if (nextStatus === 'Approved') {
            tr.approvedBy = `${currentRole} Supervisor`;
          }
          tempTransfers[transferIdx] = tr;

          const transferItems = tr.items && tr.items.length > 0
            ? tr.items
            : [{ itemCode: tr.itemCode, itemName: tr.itemName, qty: tr.qty }];

          for (const item of transferItems) {
            const prod = tempProducts.find(p => p.itemCode === item.itemCode);
            const barcode = prod ? prod.barcode : `BAR-${item.itemCode}`;

            if (nextStatus === 'Dispatched') {
              localUpdateStockBalance(tr.sourceWarehouseId, tr.sourceWarehouseName, item.itemCode, item.itemName, -item.qty, barcode, 'availableQty');
              localUpdateStockBalance(tr.sourceWarehouseId, tr.sourceWarehouseName, item.itemCode, item.itemName, item.qty, barcode, 'inTransitQty');

              tempMovements.push({
                id: `mov-${tx.id}-${item.itemCode}-out`,
                date: new Date(tx.timestamp).toISOString().slice(0, 10),
                time: new Date(tx.timestamp).toLocaleTimeString(),
                itemCode: item.itemCode,
                itemName: item.itemName,
                warehouseId: tr.sourceWarehouseId,
                warehouseName: tr.sourceWarehouseName,
                qty: -item.qty,
                transactionType: 'Transfer Out',
                referenceNumber: tr.transferNumber,
                user: `${currentRole} Operator`,
                remarks: `[Offline Pending] Dispatched to warehouse ${tr.destWarehouseName}. Marked In-Transit.`,
                fromWarehouseId: tr.sourceWarehouseId,
                fromWarehouseName: tr.sourceWarehouseName,
                toWarehouseId: tr.destWarehouseId,
                toWarehouseName: tr.destWarehouseName
              });
            }

            if (nextStatus === 'Received') {
              localUpdateStockBalance(tr.sourceWarehouseId, tr.sourceWarehouseName, item.itemCode, item.itemName, -item.qty, barcode, 'inTransitQty');
              localUpdateStockBalance(tr.destWarehouseId, tr.destWarehouseName, item.itemCode, item.itemName, item.qty, barcode, 'availableQty');

              tempMovements.push({
                id: `mov-${tx.id}-${item.itemCode}-in`,
                date: new Date(tx.timestamp).toISOString().slice(0, 10),
                time: new Date(tx.timestamp).toLocaleTimeString(),
                itemCode: item.itemCode,
                itemName: item.itemName,
                warehouseId: tr.destWarehouseId,
                warehouseName: tr.destWarehouseName,
                qty: item.qty,
                transactionType: 'Transfer In',
                referenceNumber: tr.transferNumber,
                user: `${currentRole} Operator`,
                remarks: `[Offline Pending] Received and stacked. ${remarks || ''}`,
                fromWarehouseId: tr.sourceWarehouseId,
                fromWarehouseName: tr.sourceWarehouseName,
                toWarehouseId: tr.destWarehouseId,
                toWarehouseName: tr.destWarehouseName
              });
            }
          }

          tempAuditLogs.push({
            id: `aud-${tx.id}`,
            date: new Date(tx.timestamp).toISOString().slice(0, 10),
            time: new Date(tx.timestamp).toLocaleTimeString(),
            user: `${currentRole} Operator`,
            action: 'Transition Transfer status (Offline)',
            module: 'Inter-Warehouse Transfer',
            details: `[Offline Pending] No: ${tr.transferNumber}, Shifted: ${oldStatus} ➔ ${nextStatus}`
          });
        }
      }

      else if (type === 'POST_ADJUSTMENT') {
        const adj = payload;
        const warehouse = tempWarehouses.find(w => w.code === adj.warehouseId);
        const prod = tempProducts.find(p => p.itemCode === adj.itemCode);
        if (warehouse && prod) {
          let multiplier = 1;
          let field: 'availableQty' | 'reservedQty' | 'inTransitQty' | 'damagedQty' = 'availableQty';
          let transactionLabel = '';

          if (adj.type === 'Increase' || adj.type === 'Excess') {
            multiplier = 1;
            field = 'availableQty';
            transactionLabel = 'Adjustment (Add)';
          } else if (adj.type === 'Decrease' || adj.type === 'Shortage') {
            multiplier = -1;
            field = 'availableQty';
            transactionLabel = 'Adjustment (Sub)';
          } else if (adj.type === 'Damage') {
            localUpdateStockBalance(adj.warehouseId, warehouse.name, adj.itemCode, prod.name, -adj.qty, prod.barcode, 'availableQty');
            localUpdateStockBalance(adj.warehouseId, warehouse.name, adj.itemCode, prod.name, adj.qty, prod.barcode, 'damagedQty');
            multiplier = 0;
            transactionLabel = 'Adjustment (Damage)';
          }

          if (multiplier !== 0) {
            localUpdateStockBalance(
              adj.warehouseId,
              warehouse.name,
              adj.itemCode,
              prod.name,
              adj.qty * multiplier,
              prod.barcode,
              field
            );
          }

          const overrideDocNo = `ADJ-${Math.floor(100000 + Math.random() * 900000)}`;
          tempMovements.push({
            id: `mov-${tx.id}`,
            date: new Date(tx.timestamp).toISOString().slice(0, 10),
            time: new Date(tx.timestamp).toLocaleTimeString(),
            itemCode: adj.itemCode,
            itemName: prod.name,
            warehouseId: adj.warehouseId,
            warehouseName: warehouse.name,
            qty: multiplier !== 0 ? adj.qty * multiplier : adj.qty,
            transactionType: transactionLabel as any,
            referenceNumber: overrideDocNo,
            user: `${currentRole} Operator`,
            remarks: `[Offline Pending] Reason: ${adj.reason}. Remarks: ${adj.remarks}`
          });

          tempAuditLogs.push({
            id: `aud-${tx.id}`,
            date: new Date(tx.timestamp).toISOString().slice(0, 10),
            time: new Date(tx.timestamp).toLocaleTimeString(),
            user: `${currentRole} Operator`,
            action: 'Manual Stock Adjustment (Offline)',
            module: 'Stock Adjustment',
            details: `[Offline Pending] Item: ${adj.itemCode}, Qty: ${adj.qty} in WH: ${adj.warehouseId}`
          });
        }
      }

      else if (type === 'ADD_PRODUCT') {
        const { restProd, openingStock, openingWarehouseId } = payload;
        if (!tempProducts.some(p => p.itemCode === restProd.itemCode)) {
          tempProducts.push({ id: tx.id, ...restProd });

          if (openingStock && openingStock > 0 && openingWarehouseId) {
            const targetWh = tempWarehouses.find(w => w.id === openingWarehouseId || w.code === openingWarehouseId);
            const whName = targetWh ? targetWh.name : 'Unknown Warehouse';
            const whId = targetWh?.id || openingWarehouseId;

            localUpdateStockBalance(
              whId,
              whName,
              restProd.itemCode,
              restProd.name,
              openingStock,
              restProd.barcode || `BAR-${restProd.itemCode}`,
              'availableQty'
            );

            tempMovements.push({
              id: `mov-${tx.id}`,
              date: new Date(tx.timestamp).toISOString().slice(0, 10),
              time: new Date(tx.timestamp).toLocaleTimeString(),
              itemCode: restProd.itemCode,
              itemName: restProd.name,
              warehouseId: whId,
              warehouseName: whName,
              qty: openingStock,
              transactionType: 'Adjustment (Add)',
              referenceNumber: `OP-${restProd.itemCode}`,
              user: currentUserName || 'System',
              remarks: '[Offline Pending] Opening Stock Balance Initialization'
            });

            tempAuditLogs.push({
              id: `aud-${tx.id}`,
              date: new Date(tx.timestamp).toISOString().slice(0, 10),
              time: new Date(tx.timestamp).toLocaleTimeString(),
              user: currentUserName || 'System',
              action: 'Initial Opening Stock (Offline)',
              module: 'Product Catalog',
              details: `[Offline Pending] SKU: ${restProd.itemCode}, Warehouse: ${whName}, Qty: ${openingStock}`
            });
          }

          tempAuditLogs.push({
            id: `aud-p-${tx.id}`,
            date: new Date(tx.timestamp).toISOString().slice(0, 10),
            time: new Date(tx.timestamp).toLocaleTimeString(),
            user: currentUserName || 'System',
            action: 'Create SKU Product (Offline)',
            module: 'Product Catalog',
            details: `[Offline Pending] SKU: ${restProd.itemCode}, Title: ${restProd.name}`
          });
        }
      }

      else if (type === 'ADD_WAREHOUSE') {
        const wh = payload;
        if (!tempWarehouses.some(w => w.code === wh.code)) {
          if (wh.isPrimary) {
            tempWarehouses = tempWarehouses.map(w => ({ ...w, isPrimary: false }));
          }
          tempWarehouses.push({ id: tx.id, ...wh });
          tempAuditLogs.push({
            id: `aud-${tx.id}`,
            date: new Date(tx.timestamp).toISOString().slice(0, 10),
            time: new Date(tx.timestamp).toLocaleTimeString(),
            user: currentUserName || 'System',
            action: 'Create Warehouse Profile (Offline)',
            module: 'Warehouse Setup',
            details: `[Offline Pending] Code: ${wh.code} (${wh.isPrimary ? 'Primary' : 'Secondary'})`
          });
        }
      }

      else if (type === 'ADD_CUSTOMER') {
        const cust = payload;
        if (!tempCustomers.some(c => c.name === cust.name || c.gstNumber === cust.gstNumber)) {
          tempCustomers.push({ id: tx.id, ...cust });
          tempAuditLogs.push({
            id: `aud-${tx.id}`,
            date: new Date(tx.timestamp).toISOString().slice(0, 10),
            time: new Date(tx.timestamp).toLocaleTimeString(),
            user: currentUserName || 'System',
            action: 'Register Customer Master (Offline)',
            module: 'Masters Settings',
            details: `[Offline Pending] Account: ${cust.name}`
          });
        }
      }

      else if (type === 'ADD_SUPPLIER') {
        const sup = payload;
        if (!tempSuppliers.some(s => s.name === sup.name)) {
          tempSuppliers.push({ id: tx.id, ...sup });
          tempAuditLogs.push({
            id: `aud-${tx.id}`,
            date: new Date(tx.timestamp).toISOString().slice(0, 10),
            time: new Date(tx.timestamp).toLocaleTimeString(),
            user: currentUserName || 'System',
            action: 'Register Supplier Master (Offline)',
            module: 'Masters Settings',
            details: `[Offline Pending] Vendor: ${sup.name}`
          });
        }
      }
    });

    return {
      derivedInwards: tempInwards,
      derivedOutwards: tempOutwards,
      derivedTransfers: tempTransfers,
      derivedMovements: tempMovements,
      derivedStocks: tempStocks,
      derivedAuditLogs: tempAuditLogs,
      derivedProducts: tempProducts,
      derivedCustomers: tempCustomers,
      derivedSuppliers: tempSuppliers,
      derivedWarehouses: tempWarehouses
    };
  }, [inwards, outwards, transfers, movements, stocks, auditLogs, offlineQueue, products, warehouses, currentRole, suppliers, customers]);

  // Automatically reconcile the selected warehouse ID if it is invalid or deleted (self-healing for WH-MUM missing)
  useEffect(() => {
    if (derivedWarehouses.length > 0) {
      const exists = derivedWarehouses.some(w => w.id === currentWarehouseId || w.code === currentWarehouseId);
      if (!exists) {
        const primary = derivedWarehouses.find(w => w.isPrimary) || derivedWarehouses[0];
        const safeId = primary.code || primary.id;
        if (safeId) {
          setCurrentWarehouseId(safeId);
          console.log(`Self-healing active: Switched current warehouse to existing "${safeId}" as "${currentWarehouseId}" was not found.`);
        }
      }
    }
  }, [derivedWarehouses, currentWarehouseId]);

  // ----------------------------------------------------
  // WRITING HANDLERS
  // ----------------------------------------------------

  // 1. PRODUCT CRUD
  const handleAddProduct = async (prod: Omit<Product, 'id'> & { openingStock?: number; openingWarehouseId?: string }) => {
    if (currentRole === 'Viewer') {
      alert('Access Denied: Users with the Viewer role are not authorized to create products.');
      return;
    }
    const { openingStock, openingWarehouseId, ...restProd } = prod;

    if (!isOnline) {
      const txId = `off-tx-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const tx: OfflineTransaction = {
        id: txId,
        type: 'ADD_PRODUCT',
        payload: { restProd, openingStock, openingWarehouseId, product: restProd },
        timestamp: Date.now()
      };
      const updatedQueue = [...offlineQueue, tx];
      setOfflineQueue(updatedQueue);
      localStorage.setItem('stockflow_offline_queue', JSON.stringify(updatedQueue));
      await sendNotification(
        'Product Added (Offline)',
        `SKU ${prod.itemCode}: ${prod.name} created offline (Pending cloud sync).`,
        'transaction',
        '',
        '',
        ''
      );
      return;
    }

    const key = IdempotencyKeys.product(prod.itemCode);
    await runIdempotent(key, async () => {
      const targetWh = warehouses.find(w => w.id === openingWarehouseId || w.code === openingWarehouseId);
      const whName = targetWh ? targetWh.name : 'Unknown Warehouse';
      const whId = targetWh?.id || openingWarehouseId;

      await addProductWithInitialStockAtomic(db, {
        product: restProd as Product,
        openingStock,
        openingWarehouseId: whId,
        warehouseName: whName,
        user: currentUserName || `${currentRole} Operator`,
        role: currentRole
      });

      await logAudit('Create SKU Product', 'Product Catalog', `SKU: ${prod.itemCode}, Title: ${prod.name}`);
      if (openingStock && openingStock > 0 && openingWarehouseId) {
        await logAudit('Initial Opening Stock', 'Product Catalog', `SKU: ${prod.itemCode}, Warehouse: ${whName}, Qty: ${openingStock}`);
      }
    });
  };

  const handleAddProductsBulk = async (
    prods: (Omit<Product, 'id'> & { openingStock?: number; openingWarehouseId?: string })[]
  ) => {
    for (const prod of prods) {
      await handleAddProduct(prod);
    }
  };

  const handleUpdateProduct = async (prod: Product) => {
    if (!prod.id) return;
    await updateDoc(doc(db, 'products', prod.id), {
      name: prod.name,
      category: prod.category,
      unit: prod.unit,
      minStock: prod.minStock,
      purchaseRate: prod.purchaseRate,
      sellingRate: prod.sellingRate,
      gst: prod.gst,
      description: prod.description,
      image: prod.image,
    });
    await logAudit('Modify SKU Product', 'Product Catalog', `SKU: ${prod.itemCode}`);
  };

  // 2. WAREHOUSE CRUD
  const handleAddWarehouse = async (wh: Omit<Warehouse, 'id'>) => {
    if (!isOnline) {
      const txId = `off-tx-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const tx: OfflineTransaction = {
        id: txId,
        type: 'ADD_WAREHOUSE',
        payload: wh,
        timestamp: Date.now()
      };
      const updatedQueue = [...offlineQueue, tx];
      setOfflineQueue(updatedQueue);
      localStorage.setItem('stockflow_offline_queue', JSON.stringify(updatedQueue));
      await sendNotification(
        'Warehouse Registered (Offline)',
        `Warehouse ${wh.name} (${wh.code}) created offline (Pending cloud sync).`,
        'transaction',
        '',
        '',
        ''
      );
      return;
    }

    const key = IdempotencyKeys.warehouse(wh.code);
    await runIdempotent(key, async () => {
      const whCheckQuery = query(collection(db, 'warehouses'), where('code', '==', wh.code));
      const whCheckSnap = await getDocs(whCheckQuery);
      if (!whCheckSnap.empty) {
        console.warn(`Warehouse code ${wh.code} already exists. Skipping duplicate.`);
        return;
      }

      if (wh.isPrimary) {
        // Unset all other primary warehouses
        for (const w of warehouses) {
          if (w.isPrimary && w.id) {
            await updateDoc(doc(db, 'warehouses', w.id), { isPrimary: false });
          }
        }
      }
      await addDoc(collection(db, 'warehouses'), wh);
      await logAudit('Register Warehouse', 'Warehouse Setup', `Code: ${wh.code}, Name: ${wh.name} (${wh.isPrimary ? 'Primary' : 'Secondary'})`);
    });
  };

  const handleUpdateWarehouse = async (wh: Warehouse) => {
    if (!wh.id) return;
    if (wh.isPrimary) {
      // Unset all other primary warehouses
      for (const w of warehouses) {
        if (w.isPrimary && w.id && w.id !== wh.id) {
          await updateDoc(doc(db, 'warehouses', w.id), { isPrimary: false });
        }
      }
    }
    await updateDoc(doc(db, 'warehouses', wh.id), {
      name: wh.name,
      address: wh.address,
      city: wh.city,
      state: wh.state,
      contactPerson: wh.contactPerson,
      phone: wh.phone,
      status: wh.status,
      isPrimary: wh.isPrimary ?? false,
    });
    await logAudit('Update Warehouse Metadata', 'Warehouse Setup', `Code: ${wh.code} (${wh.isPrimary ? 'Primary' : 'Secondary'})`);
  };

  // 3. INWARD GRN POSTING
  const handleAddInward = async (inward: Omit<Inward, 'id'>) => {
    if (currentRole === 'Viewer') {
      alert('Access Denied: Users with the Viewer role are not authorized to post Inward GRN transactions.');
      return;
    }
    const supplier = suppliers.find(s => s.id === inward.supplierId || s.name === inward.supplierName);
    const warehouse = warehouses.find(w => w.code === inward.warehouseId || w.id === inward.warehouseId);
    const contactPhone = supplier?.phone || warehouse?.phone || '';
    const contactName = supplier?.contactPerson || warehouse?.contactPerson || '';
    const roleName = supplier?.phone ? 'Supplier' : (warehouse?.phone ? 'Warehouse Manager' : '');

    if (!isOnline) {
      const txId = `off-tx-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const tx: OfflineTransaction = {
        id: txId,
        type: 'ADD_INWARD',
        payload: inward,
        timestamp: Date.now()
      };
      const updatedQueue = [...offlineQueue, tx];
      setOfflineQueue(updatedQueue);
      localStorage.setItem('stockflow_offline_queue', JSON.stringify(updatedQueue));
      await sendNotification(
        'Inward GRN Posted (Offline)',
        `GRN ${inward.grnNumber}: Received ${inward.qty} Pcs of ${inward.itemName} at ${inward.warehouseName} (Pending cloud sync).`,
        'received',
        contactPhone,
        contactName,
        roleName
      );
      return;
    }

    const key = IdempotencyKeys.inward(inward.grnNumber, inward.itemCode);
    await runIdempotent(key, async () => {
      // Get product barcode
      const prod = products.find(p => p.itemCode === inward.itemCode);
      const barcode = prod ? prod.barcode : `BAR-${inward.itemCode}`;

      // Atomic write: Inward Doc + Stock Doc + Movement Ledger Doc
      await postInwardAtomic(db, inward, barcode, currentRole);

      await logAudit('Post GRN Document', 'Material Inward', `GRN: ${inward.grnNumber}, Qty: ${inward.qty} of ${inward.itemCode}`);
      await sendNotification(
        'Inward GRN Posted',
        `GRN ${inward.grnNumber}: Received ${inward.qty} Pcs of ${inward.itemName} at ${inward.warehouseName}.`,
        'received',
        contactPhone,
        contactName,
        roleName
      );
    });
  };

  // 4. OUTWARD CUSTOMER DISPATCH POSTING
  const handleAddOutward = async (outward: Omit<Outward, 'id'>) => {
    if (currentRole === 'Viewer') {
      alert('Access Denied: Users with the Viewer role are not authorized to post Outward Dispatch transactions.');
      return;
    }
    const customer = customers.find(c => c.id === outward.customerId || c.name === outward.customerName);
    const warehouse = warehouses.find(w => w.code === outward.warehouseId || w.id === outward.warehouseId);
    const contactPhone = customer?.phone || warehouse?.phone || '';
    const contactName = customer?.contactPerson || warehouse?.contactPerson || '';
    const roleName = customer?.phone ? 'Customer' : (warehouse?.phone ? 'Warehouse Manager' : '');

    if (!isOnline) {
      const txId = `off-tx-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const tx: OfflineTransaction = {
        id: txId,
        type: 'ADD_OUTWARD',
        payload: outward,
        timestamp: Date.now()
      };
      const updatedQueue = [...offlineQueue, tx];
      setOfflineQueue(updatedQueue);
      localStorage.setItem('stockflow_offline_queue', JSON.stringify(updatedQueue));
      await sendNotification(
        'Material Outward Dispatched (Offline)',
        `Dispatch ${outward.dispatchNumber}: Shipped ${outward.qty} Pcs of ${outward.itemName} from ${outward.warehouseName} to customer ${outward.customerName} (Pending cloud sync).`,
        'transaction',
        contactPhone,
        contactName,
        roleName
      );
      return;
    }

    const key = IdempotencyKeys.outward(outward.dispatchNumber, outward.itemCode);
    await runIdempotent(key, async () => {
      // Get product barcode
      const prod = products.find(p => p.itemCode === outward.itemCode);
      const barcode = prod ? prod.barcode : `BAR-${outward.itemCode}`;

      // Atomic write: Outward Doc + Stock Doc + Movement Ledger Doc
      await postOutwardAtomic(db, outward, barcode, currentRole);

      await logAudit('Post Dispatch Outward', 'Material Outward', `DSP: ${outward.dispatchNumber}, Qty: -${outward.qty} of ${outward.itemCode}`);
      await sendNotification(
        'Material Outward Dispatched',
        `Dispatch ${outward.dispatchNumber}: Shipped ${outward.qty} Pcs of ${outward.itemName} from ${outward.warehouseName} to customer ${outward.customerName}.`,
        'transaction',
        contactPhone,
        contactName,
        roleName
      );
    });
  };

  // 5. INTER-WAREHOUSE TRANSFERS
  const handleAddTransfer = async (tr: Omit<Transfer, 'id'>) => {
    if (currentRole === 'Viewer') {
      alert('Access Denied: Users with the Viewer role are not authorized to initiate Transfer requests.');
      return;
    }
    const sourceWh = warehouses.find(w => w.code === tr.sourceWarehouseId || w.id === tr.sourceWarehouseId);
    const destWh = warehouses.find(w => w.code === tr.destWarehouseId || w.id === tr.destWarehouseId);
    const contactPhone = destWh?.phone || sourceWh?.phone || '';
    const contactName = destWh?.contactPerson || sourceWh?.contactPerson || '';
    const roleName = 'Warehouse Manager';

    if (!isOnline) {
      const txId = `off-tx-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const tx: OfflineTransaction = {
        id: txId,
        type: 'ADD_TRANSFER',
        payload: tr,
        timestamp: Date.now()
      };
      const updatedQueue = [...offlineQueue, tx];
      setOfflineQueue(updatedQueue);
      localStorage.setItem('stockflow_offline_queue', JSON.stringify(updatedQueue));
      await sendNotification(
        'Stock Transfer Requested (Offline)',
        `Transfer ${tr.transferNumber}: Requested ${tr.qty} Pcs of ${tr.itemName} from ${tr.sourceWarehouseName} to ${tr.destWarehouseName} (Pending cloud sync).`,
        'pending_transfer',
        contactPhone,
        contactName,
        roleName
      );
      return;
    }

    const key = IdempotencyKeys.transferCreate(tr.transferNumber);
    await runIdempotent(key, async () => {
      const existingTrQuery = query(collection(db, 'transfers'), where('transferNumber', '==', tr.transferNumber));
      const existingTrSnap = await getDocs(existingTrQuery);
      if (!existingTrSnap.empty) {
        console.warn(`Transfer ${tr.transferNumber} already created. Skipping duplicate.`);
        return;
      }

      await addDoc(collection(db, 'transfers'), tr);
      await logAudit('Draft Transfer Request', 'Inter-Warehouse Transfer', `No: ${tr.transferNumber}, Source: ${tr.sourceWarehouseId} -> Dest: ${tr.destWarehouseId}`);
      await sendNotification(
        'Stock Transfer Requested',
        `Transfer ${tr.transferNumber}: Requested ${tr.qty} Pcs of ${tr.itemName} from ${tr.sourceWarehouseName} to ${tr.destWarehouseName}.`,
        'pending_transfer',
        contactPhone,
        contactName,
        roleName
      );
    });
  };

  // Fully Professional Transfer Status Workflow transitions with stock adjustments:
  const handleUpdateTransferStatus = async (
    id: string,
    nextStatus: Transfer['status'],
    remarks?: string,
    receiptDetails?: {
      items?: { itemCode: string; itemName: string; qty: number; receivedQty: number; shortQty: number; shortReason?: string }[];
      receivingRemarks?: string;
    }
  ) => {
    if (currentRole === 'Viewer') {
      alert('Access Denied: Users with the Viewer role are not authorized to update Transfer status.');
      return;
    }
    if (!isOnline) {
      const txId = `off-tx-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const tx: OfflineTransaction = {
        id: txId,
        type: 'UPDATE_TRANSFER_STATUS',
        payload: { id, nextStatus, remarks, receiptDetails },
        timestamp: Date.now()
      };
      const updatedQueue = [...offlineQueue, tx];
      setOfflineQueue(updatedQueue);
      localStorage.setItem('stockflow_offline_queue', JSON.stringify(updatedQueue));
      await sendNotification(
        `Transfer Status Updated (Offline)`,
        `Transfer request status transitioned to ${nextStatus} (Pending cloud sync).`,
        'transaction'
      );
      return;
    }

    const key = IdempotencyKeys.transferStatus(id, nextStatus);
    await runIdempotent(key, async () => {
      // Build barcodes map
      const barcodesMap: Record<string, string> = {};
      for (const p of products) {
        barcodesMap[p.itemCode] = p.barcode;
      }

      await updateTransferStatusAtomic(db, {
        id,
        nextStatus,
        user: `${currentRole} Operator`,
        currentRole,
        remarks,
        receiptDetails,
        productBarcodes: barcodesMap
      });

      const tr = transfers.find(t => t.id === id);
      const oldStatus = tr?.status || 'Unknown';
      const sourceWh = warehouses.find(w => w.code === tr?.sourceWarehouseId || w.id === tr?.sourceWarehouseId);
      const destWh = warehouses.find(w => w.code === tr?.destWarehouseId || w.id === tr?.destWarehouseId);
      const contactPhone = destWh?.phone || sourceWh?.phone || '';
      const contactName = destWh?.contactPerson || sourceWh?.contactPerson || '';
      const roleName = 'Warehouse Manager';

      await logAudit(
        `Transition Transfer status`,
        'Inter-Warehouse Transfer',
        `No: ${tr?.transferNumber || id}, Shifted: ${oldStatus} ➔ ${nextStatus}`
      );
      await sendNotification(
        `Transfer Status Updated`,
        `Transfer ${tr?.transferNumber || id} status changed from ${oldStatus} to ${nextStatus}. ${remarks ? `Remarks: ${remarks}` : ''}`,
        nextStatus === 'Received' ? 'received' : 'transaction',
        contactPhone,
        contactName,
        roleName
      );
    });
  };

  // ADMIN AUTHORIZATION: Edit Transfer Entry Before Dispatch
  const handleEditTransfer = async (id: string, updatedFields: Partial<Transfer>) => {
    if (!isOnline) {
      alert("Editing transfer orders requires an active network connection.");
      return;
    }
    const docRef = doc(db, 'transfers', id);
    const transferSnap = await getDoc(docRef);
    if (!transferSnap.exists()) return;

    const tr = transferSnap.data() as Transfer;
    if (tr.status === 'Dispatched' || tr.status === 'In Transit' || tr.status === 'Received' || tr.status === 'Closed') {
      alert(`Transfer order ${tr.transferNumber} is in state '${tr.status}' and cannot be edited directly. Use Undo Entry to revert stock and status first.`);
      return;
    }

    await updateDoc(docRef, {
      ...updatedFields,
      updatedAt: new Date().toISOString(),
      updatedBy: `${currentRole} Admin`
    });

    await logAudit('Edit Transfer Order', 'Inter-Warehouse Transfer', `Admin edited Transfer TRF: ${tr.transferNumber} before dispatch.`);
    await sendNotification('Transfer Order Updated', `Transfer order ${tr.transferNumber} was edited by Admin before dispatch.`, 'transaction');
  };

  // ADMIN AUTHORIZATION: Undo / Revert Transfer Entry with complete stock reversal
  const handleUndoTransfer = async (id: string, targetStatus: 'Pending Approval' | 'Draft' = 'Pending Approval') => {
    if (!isOnline) {
      alert("Undoing transfer entries requires an active network connection to safely revert stock balances.");
      return;
    }

    const key = IdempotencyKeys.transferUndo(id);
    await runIdempotent(key, async () => {
      const barcodesMap: Record<string, string> = {};
      for (const p of products) {
        barcodesMap[p.itemCode] = p.barcode;
      }

      const res = await undoTransferAtomic(db, {
        transferId: id,
        targetStatus,
        user: `${currentRole} Admin`,
        role: currentRole,
        productBarcodes: barcodesMap
      });

      await logAudit('Undo Transfer Entry', 'Inter-Warehouse Transfer', `Reverted transfer entry ${res.transferNumber}. Restored stock balances and set status to ${targetStatus}.`);
      await sendNotification('Transfer Entry Reverted', `Transfer entry ${res.transferNumber} was undone by Admin. Inventory balances restored.`, 'transaction');
    });
  };

  // 6. MANUAL STOCK ADJUSTMENTS OVERRIDES
  const handlePostAdjustment = async (adj: {
    itemCode: string;
    warehouseId: string;
    type: 'Increase' | 'Decrease' | 'Damage' | 'Shortage' | 'Excess';
    qty: number;
    reason: string;
    remarks: string;
    idempotencyKey?: string;
  }) => {
    if (currentRole !== 'Super Admin') {
      alert('Access Denied: Only Super Admins are authorized to execute manual stock adjustments.');
      return;
    }
    if (!isOnline) {
      const txId = `off-tx-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const tx: OfflineTransaction = {
        id: txId,
        type: 'POST_ADJUSTMENT',
        payload: adj,
        timestamp: Date.now()
      };
      const updatedQueue = [...offlineQueue, tx];
      setOfflineQueue(updatedQueue);
      localStorage.setItem('stockflow_offline_queue', JSON.stringify(updatedQueue));
      await sendNotification(
        'Stock Adjustment Posted (Offline)',
        `Adjustment: ${adj.type} of ${adj.qty} Pcs of SKU ${adj.itemCode} in warehouse ${adj.warehouseId} (Pending cloud sync).`,
        'adjustment'
      );
      return;
    }

    const warehouse = warehouses.find(w => w.code === adj.warehouseId);
    const prod = products.find(p => p.itemCode === adj.itemCode);
    if (!warehouse || !prod) return;

    const adjKey = adj.idempotencyKey || `ADJ-${adj.itemCode}-${adj.warehouseId}-${adj.type}-${adj.qty}-${Date.now().toString().slice(0, -3)}`;
    const key = IdempotencyKeys.adjustment(adjKey);

    await runIdempotent(key, async () => {
      const res = await postStockAdjustmentAtomic(db, {
        itemCode: adj.itemCode,
        itemName: prod.name,
        warehouseId: adj.warehouseId,
        warehouseName: warehouse.name,
        barcode: prod.barcode || `BAR-${adj.itemCode}`,
        type: adj.type,
        qty: adj.qty,
        reason: adj.reason,
        remarks: adj.remarks,
        user: `${currentRole} Operator`,
        role: currentRole
      });

      await logAudit(
        'Post Stock Adjustment Override',
        'Stock Adjustment',
        `ADJ No: ${res.overrideDocNo}, Type: ${adj.type}, Qty: ${adj.qty} of ${adj.itemCode}`
      );
      await sendNotification(
        'Stock Adjustment Posted',
        `Adjustment: ${adj.type} of ${adj.qty} Pcs of ${prod.name} at ${warehouse.name}. Reason: ${adj.reason}`,
        'adjustment'
      );
    });
  };

  // REVERT MANUAL STOCK ADJUSTMENT
  const handleRevertAdjustment = async (
    adjustmentIdOrRef: string,
    reason: string = 'Manual Adjustment Reverted by Admin'
  ) => {
    if (currentRole !== 'Super Admin') {
      alert('Access Denied: Only Super Admins are authorized to revert manual stock adjustments.');
      return;
    }
    if (!isOnline) {
      const txId = `off-tx-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const tx: OfflineTransaction = {
        id: txId,
        type: 'REVERT_ADJUSTMENT',
        payload: { adjustmentIdOrRef, reason },
        timestamp: Date.now()
      };
      const updatedQueue = [...offlineQueue, tx];
      setOfflineQueue(updatedQueue);
      localStorage.setItem('stockflow_offline_queue', JSON.stringify(updatedQueue));
      await sendNotification(
        'Stock Adjustment Reversal (Offline)',
        `Reversal of adjustment ${adjustmentIdOrRef} queued (Pending cloud sync).`,
        'adjustment'
      );
      return;
    }

    const key = IdempotencyKeys.adjustmentRevert(adjustmentIdOrRef);
    await runIdempotent(key, async () => {
      // Locate movement ID
      let mvtDoc = movements.find(m => m.id === adjustmentIdOrRef || m.referenceNumber === adjustmentIdOrRef);
      let targetMvtId = mvtDoc?.id || adjustmentIdOrRef;

      if (!mvtDoc && db) {
        try {
          const docRef = doc(db, 'movements', adjustmentIdOrRef);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            mvtDoc = { id: docSnap.id, ...docSnap.data() } as StockMovement;
            targetMvtId = docSnap.id;
          }
        } catch (err) {
          console.error("Error fetching movement for reversal:", err);
        }
      }

      if (!mvtDoc) {
        alert("Selected stock adjustment record could not be found!");
        return;
      }

      const barcodesMap: Record<string, string> = {};
      for (const p of products) {
        barcodesMap[p.itemCode] = p.barcode;
      }

      const res = await revertStockAdjustmentAtomic(db, {
        originalMovementId: targetMvtId,
        reason,
        user: `${currentRole} Operator`,
        role: currentRole,
        productBarcodes: barcodesMap
      });

      // Log in Security Audit Trail
      await logAudit(
        'Revert Stock Adjustment',
        'Stock Adjustment',
        `Reverted adjustment ${mvtDoc.referenceNumber || targetMvtId} (original movement ID: ${targetMvtId}, reversal movement ID: ${res.reversalMovementId}, SKU: ${mvtDoc.itemCode} @ ${mvtDoc.warehouseName}, Qty: ${Math.abs(mvtDoc.qty)}). User: ${currentRole} Operator. Reason: ${reason}`
      );

      // Send Notification
      await sendNotification(
        'Stock Adjustment Reverted',
        `Manual stock adjustment ${mvtDoc.referenceNumber || targetMvtId} for SKU ${mvtDoc.itemCode} was reverted. Previous balance restored. Reason: ${reason}`,
        'adjustment'
      );
    });
  };

  // 7. SUPPLIER Master CRUD
  const handleAddSupplier = async (sup: Omit<Supplier, 'id'>) => {
    if (!isOnline) {
      const txId = `off-tx-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const tx: OfflineTransaction = {
        id: txId,
        type: 'ADD_SUPPLIER',
        payload: sup,
        timestamp: Date.now()
      };
      const updatedQueue = [...offlineQueue, tx];
      setOfflineQueue(updatedQueue);
      localStorage.setItem('stockflow_offline_queue', JSON.stringify(updatedQueue));
      await sendNotification(
        'Vendor Registered (Offline)',
        `Supplier ${sup.name} registered offline (Pending cloud sync).`,
        'transaction',
        '',
        '',
        ''
      );
      return;
    }

    const key = IdempotencyKeys.supplier(sup.name, sup.phone);
    await runIdempotent(key, async () => {
      const supCheckQuery = query(collection(db, 'suppliers'), where('name', '==', sup.name));
      const supCheckSnap = await getDocs(supCheckQuery);
      if (!supCheckSnap.empty) {
        console.warn(`Supplier ${sup.name} already exists. Skipping duplicate.`);
        return;
      }

      await addDoc(collection(db, 'suppliers'), sup);
      await logAudit('Register Supplier Master', 'Masters Settings', `Vendor: ${sup.name}`);
    });
  };

  const handleUpdateSupplier = async (sup: Supplier) => {
    if (!sup.id) return;
    await updateDoc(doc(db, 'suppliers', sup.id), {
      name: sup.name,
      gstNumber: sup.gstNumber,
      panNumber: sup.panNumber,
      address: sup.address,
      contactPerson: sup.contactPerson,
      phone: sup.phone,
      email: sup.email
    });
    await logAudit('Modify Supplier Master', 'Masters Settings', `Vendor: ${sup.name}`);
  };

  // 8. CUSTOMER Master CRUD
  const handleAddCustomer = async (cust: Omit<Customer, 'id'>) => {
    if (!isOnline) {
      const txId = `off-tx-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const tx: OfflineTransaction = {
        id: txId,
        type: 'ADD_CUSTOMER',
        payload: cust,
        timestamp: Date.now()
      };
      const updatedQueue = [...offlineQueue, tx];
      setOfflineQueue(updatedQueue);
      localStorage.setItem('stockflow_offline_queue', JSON.stringify(updatedQueue));
      await sendNotification(
        'Customer Profile Registered (Offline)',
        `Account ${cust.name} registered offline (Pending cloud sync).`,
        'transaction',
        '',
        '',
        ''
      );
      return;
    }

    const key = IdempotencyKeys.customer(cust.name, cust.phone);
    await runIdempotent(key, async () => {
      const custCheckQuery = query(collection(db, 'customers'), where('name', '==', cust.name));
      const custCheckSnap = await getDocs(custCheckQuery);
      if (!custCheckSnap.empty) {
        console.warn(`Customer ${cust.name} already exists. Skipping duplicate.`);
        return;
      }

      await addDoc(collection(db, 'customers'), cust);
      await logAudit('Register Customer Master', 'Masters Settings', `Account: ${cust.name}`);
    });
  };

  const handleAddCustomersBulk = async (custs: Omit<Customer, 'id'>[]) => {
    for (const cust of custs) {
      await handleAddCustomer(cust);
    }
  };

  const handleUpdateCustomer = async (cust: Customer) => {
    if (!cust.id) return;
    await updateDoc(doc(db, 'customers', cust.id), {
      name: cust.name,
      gstNumber: cust.gstNumber,
      address: cust.address,
      phone: cust.phone,
      email: cust.email
    });
    await logAudit('Modify Customer Master', 'Masters Settings', `Account: ${cust.name}`);
  };

  // ----------------------------------------------------
  // DELETION HANDLERS (ADMIN ONLY AUTHORITY)
  // ----------------------------------------------------
  const handleDeleteProduct = async (id: string) => {
    if (currentRole !== 'Super Admin') {
      alert('Access Denied: Only Super Admins are authorized to delete products.');
      return;
    }
    try {
      const prodRef = doc(db, 'products', id);
      const prodSnap = await getDoc(prodRef);
      const prod = prodSnap.exists() ? (prodSnap.data() as Product) : products.find(p => p.id === id);

      if (prod) {
        const code = prod.itemCode;
        
        // Delete active stocks documents for this itemCode
        const stocksSnap = await getDocs(query(collection(db, 'stocks'), where('itemCode', '==', code)));
        for (const sDoc of stocksSnap.docs) {
          await deleteDoc(doc(db, 'stocks', sDoc.id));
        }

        // Note: Historical movement records in movements collection remain intact as immutable ledger entries

        // Clean up draft inwards for this itemCode
        const inwardsSnap = await getDocs(query(collection(db, 'inwards'), where('itemCode', '==', code)));
        for (const iDoc of inwardsSnap.docs) {
          await deleteDoc(doc(db, 'inwards', iDoc.id));
        }

        // Clean up draft outwards for this itemCode
        const outwardsSnap = await getDocs(query(collection(db, 'outwards'), where('itemCode', '==', code)));
        for (const oDoc of outwardsSnap.docs) {
          await deleteDoc(doc(db, 'outwards', oDoc.id));
        }

        // Clean up transfers containing this itemCode
        const transfersSnap = await getDocs(collection(db, 'transfers'));
        for (const tDoc of transfersSnap.docs) {
          const trData = tDoc.data() as Transfer;
          if (trData.itemCode === code) {
            await deleteDoc(doc(db, 'transfers', tDoc.id));
          } else if (trData.items && trData.items.length > 0) {
            const filteredItems = trData.items.filter(item => item.itemCode !== code);
            if (filteredItems.length === 0) {
              await deleteDoc(doc(db, 'transfers', tDoc.id));
            } else {
              await updateDoc(doc(db, 'transfers', tDoc.id), { items: filteredItems });
            }
          }
        }
      }

      await deleteDoc(doc(db, 'products', id));
      await reconcileStockBalances();
      await logAudit('Delete SKU Product', 'Product Catalog', `Deleted SKU product ID: ${id}.`);
    } catch (err) {
      console.error('Error deleting product:', err);
      await deleteDoc(doc(db, 'products', id));
    }
  };

  const handleDeleteWarehouse = async (id: string) => {
    if (currentRole !== 'Super Admin') {
      alert('Access Denied: Only Super Admins are authorized to delete warehouses.');
      return;
    }
    try {
      const whRef = doc(db, 'warehouses', id);
      const whSnap = await getDoc(whRef);
      const wh = whSnap.exists() ? (whSnap.data() as Warehouse) : warehouses.find(w => w.id === id);

      if (wh) {
        const whCode = wh.code || wh.id;

        // Delete all stock balance records for this warehouse
        const stocksSnap = await getDocs(collection(db, 'stocks'));
        for (const sDoc of stocksSnap.docs) {
          const data = sDoc.data();
          if (data.warehouseId === whCode || data.warehouseId === id) {
            await deleteDoc(doc(db, 'stocks', sDoc.id));
          }
        }

        // Delete associated draft inwards, outwards, and transfers (historical movements remain immutable)
        const collectionsToCheck = ['inwards', 'outwards', 'transfers'];
        for (const colName of collectionsToCheck) {
          const snap = await getDocs(collection(db, colName));
          for (const dObj of snap.docs) {
            const data = dObj.data();
            if (
              data.warehouseId === whCode || data.warehouseId === id ||
              data.sourceWarehouseId === whCode || data.sourceWarehouseId === id ||
              data.destWarehouseId === whCode || data.destWarehouseId === id ||
              data.fromWarehouseId === whCode || data.toWarehouseId === whCode
            ) {
              await deleteDoc(doc(db, colName, dObj.id));
            }
          }
        }
      }

      await deleteDoc(doc(db, 'warehouses', id));
      await reconcileStockBalances();
      await logAudit('Delete Warehouse', 'Warehouse Setup', `Deleted Warehouse ID: ${id} and cleaned up related stock records.`);
    } catch (err) {
      console.error('Error deleting warehouse:', err);
      await deleteDoc(doc(db, 'warehouses', id));
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    await deleteDoc(doc(db, 'suppliers', id));
    await logAudit('Delete Supplier Master', 'Masters Settings', `Deleted Supplier ID: ${id}`);
  };

  const handleDeleteCustomer = async (id: string) => {
    await deleteDoc(doc(db, 'customers', id));
    await logAudit('Delete Customer Master', 'Masters Settings', `Deleted Customer ID: ${id}`);
  };

  const handleDeleteUser = async (uid: string, name: string, email: string) => {
    if (currentRole !== 'Super Admin') {
      alert('Access Denied: Only Super Admins are authorized to remove users.');
      return;
    }
    await deleteDoc(doc(db, 'users', uid));
    setUsers((prev) => prev.filter((u) => u.uid !== uid));
    localStorage.removeItem('stockflow_cache_users');
    await logAudit('Remove System User', 'Access Gatekeeper', `Removed user account: ${name} (${email})`);
  };

  const handleUpdateUser = async (uid: string, name: string, role: UserRole, warehouseId: string, phone?: string, status?: 'Active' | 'Disabled') => {
    if (currentRole !== 'Super Admin') {
      alert('Access Denied: Only Super Admins are authorized to update user profiles.');
      return;
    }
    await updateDoc(doc(db, 'users', uid), {
      name,
      role,
      warehouseId,
      phone: phone || '',
      status: status || 'Active',
      updatedAt: new Date().toISOString()
    });
    await logAudit('Update User Profile', 'Access Gatekeeper', `Updated user: ${name}, assigned role: ${role}, warehouse: ${warehouseId}, status: ${status || 'Active'}`);
  };

  const handleDeleteInward = async (id: string) => {
    if (currentRole !== 'Super Admin') {
      alert('Access Denied: Only Super Admins are authorized to delete Inward GRN records.');
      return;
    }
    if (isOnline) {
      const barcodesMap: Record<string, string> = {};
      for (const p of products) {
        barcodesMap[p.itemCode] = p.barcode;
      }

      const res = await deleteInwardAtomic(db, id, currentRole, `${currentRole} Operator`, barcodesMap);
      await reconcileStockBalances();
      await logAudit('Delete GRN Document', 'Material Inward', `Deleted Inbound ID: ${id} (GRN: ${res.grnNumber}) and recorded reversal movement.`);
    } else {
      await deleteDoc(doc(db, 'inwards', id));
      await logAudit('Delete GRN Document', 'Material Inward', `Deleted Inbound ID: ${id}`);
    }
  };

  const handleDeleteOutward = async (id: string) => {
    if (currentRole !== 'Super Admin') {
      alert('Access Denied: Only Super Admins are authorized to delete Outward Dispatch records.');
      return;
    }
    if (isOnline) {
      const barcodesMap: Record<string, string> = {};
      for (const p of products) {
        barcodesMap[p.itemCode] = p.barcode;
      }

      const res = await deleteOutwardAtomic(db, id, currentRole, `${currentRole} Operator`, barcodesMap);
      await reconcileStockBalances();
      await logAudit('Delete Dispatch Outward', 'Material Outward', `Deleted Outbound ID: ${id} (Dispatch: ${res.dispatchNumber}) and recorded reversal movement.`);
    } else {
      await deleteDoc(doc(db, 'outwards', id));
      await logAudit('Delete Dispatch Outward', 'Material Outward', `Deleted Outbound ID: ${id}`);
    }
  };

  const handleDeleteTransfer = async (id: string) => {
    if (currentRole !== 'Super Admin') {
      alert('Access Denied: Only Super Admins are authorized to delete Transfer requests.');
      return;
    }
    const tr = transfers.find(t => t.id === id);

    if (isOnline) {
      const barcodesMap: Record<string, string> = {};
      for (const p of products) {
        barcodesMap[p.itemCode] = p.barcode;
      }

      const res = await deleteTransferAtomic(db, id, currentRole, `${currentRole} Operator`, barcodesMap);
      await reconcileStockBalances();
      await logAudit('Delete Transfer Request', 'Inter-Warehouse Transfer', `Deleted Transfer ID: ${id} (No: ${res.transferNumber}) and recorded compensating ledger movements.`);
    } else {
      if (tr && (tr.status === 'Dispatched' || tr.status === 'In Transit' || tr.status === 'Received')) {
        alert("Reverting stock balances for active or completed transfers requires an active network connection.");
        return;
      }
      await deleteDoc(doc(db, 'transfers', id));
      await logAudit('Delete Transfer Request', 'Inter-Warehouse Transfer', `Deleted Transfer ID: ${id}`);
    }
  };

  const handleRearrangeDispatchSeries = async () => {
    const res = await rearrangeDispatchSeries(db, outwards, movements);
    if (res.updatedCount > 0) {
      await logAudit('Rearrange Dispatch Series', 'System Admin', `Rearranged ${res.updatedCount} draft customer dispatch series numbers.`);
    }
    return res;
  };

  const handleRearrangeTransferSeries = async () => {
    const res = await rearrangeTransferSeries(db, transfers, movements);
    if (res.updatedCount > 0) {
      await logAudit('Rearrange Transfer Series', 'System Admin', `Rearranged ${res.updatedCount} draft transfer series numbers.`);
    }
    return res;
  };

  /**
   * CHANGE 12: Non-Destructive Reconciliation Audit Engine
   * Calculates expected stock from complete ledger transaction history without mutating or deleting evidence.
   * Discrepancies, negative stock, and orphaned references generate explicit InventoryException records.
   */
  const reconcileStockBalances = async () => {
    try {
      console.log("[Stockflow Audit] Starting non-destructive stock & ledger audit...");
      const report = await runInventoryReconciliation(db, {
        currentUserName: currentUserName || 'System Auditor',
        currentUserRole: currentRole || 'Super Admin'
      });
      setLastReconciliationReport(report);
      await logAudit(
        'Run Reconciliation Audit', 
        'Reconciliation Engine', 
        `Audit finished for ${report.items?.length || 0} items across warehouses. Detected: ${report.discrepancyCount} discrepancies, ${report.negativeStockCount} negative stock balances, ${report.orphanCount} unparented ledger references.`
      );
      return report;
    } catch (err: any) {
      console.error("[Stockflow Audit] Reconciliation audit failed:", err);
      throw err;
    }
  };

  const handleResolveException = async (exceptionId: string, resolutionNote: string, resolutionTransactionId?: string) => {
    await resolveInventoryException(db, exceptionId, {
      resolvedBy: currentUserName || 'System Auditor',
      resolutionNote,
      resolutionTransactionId
    });
    await logAudit('Resolve Inventory Exception', 'Exception Management', `Resolved Exception [${exceptionId}] - Note: ${resolutionNote}`);
  };

  const handleMarkExceptionUnderReview = async (exceptionId: string, notes?: string) => {
    await markExceptionUnderReview(db, exceptionId, currentUserName || 'System Auditor', notes);
    await logAudit('Review Inventory Exception', 'Exception Management', `Marked Exception [${exceptionId}] Under Review`);
  };

  const handleReverseMovement = async (id: string, customReason?: string) => {
    try {
      const barcodesMap: Record<string, string> = {};
      for (const p of products) {
        barcodesMap[p.itemCode] = p.barcode;
      }

      const res = await reverseMovementAtomic(db, {
        movementId: id,
        customReason,
        user: `${currentRole} Operator`,
        role: currentRole,
        productBarcodes: barcodesMap
      });

      await reconcileStockBalances();
      await logAudit(
        'Revert Stock Movement Entry',
        'Immutable Audit Trail',
        `Recorded reversal movement ID [${res.reversalMovementId}] (${res.revRef}) for original movement ID [${id}]. User: ${currentRole} Operator. Reason: ${customReason || 'Manual Reversal'}`
      );
    } catch (err: any) {
      console.error('Error handling movement reversal:', err);
      alert(`Failed to reverse movement: ${err?.message || err}`);
    }
  };

  const handlePurgeAllData = async () => {
    try {
      const collectionsToPurge = [
        'products',
        'warehouses',
        'suppliers',
        'customers',
        'inwards',
        'outwards',
        'transfers',
        'stocks'
      ];

      for (const colName of collectionsToPurge) {
        const snap = await getDocs(collection(db, colName));
        for (const docObj of snap.docs) {
          await deleteDoc(doc(db, colName, docObj.id));
        }
      }

      await logAudit('PURGE ALL DATA', 'System Danger Zone', 'Super Admin initiated full system wipe. All masters, stocks, and logs purged.');
      alert('System successfully wiped! All warehouse logs, stock ledgers, and catalog masters have been deleted.');
    } catch (err: any) {
      console.error('Failed to purge data:', err);
      alert(`Wipe failed: ${err.message || err}`);
    }
  };



  // ----------------------------------------------------
  // NAVIGATION VIEW ROUTER
  // ----------------------------------------------------
  const renderActiveView = () => {
    const isSuperAdmin = currentRole === 'Super Admin';

    const displayWarehouses = isSuperAdmin
      ? derivedWarehouses
      : derivedWarehouses.filter(w => w.code === currentWarehouseId);

    const displayStocks = isSuperAdmin
      ? derivedStocks
      : derivedStocks.filter(s => s.warehouseId === currentWarehouseId);

    const displayTransfers = isSuperAdmin
      ? derivedTransfers
      : derivedTransfers.filter(t => t.sourceWarehouseId === currentWarehouseId || t.destWarehouseId === currentWarehouseId);

    const displayOutwards = isSuperAdmin
      ? derivedOutwards
      : derivedOutwards.filter(o => o.warehouseId === currentWarehouseId);

    const displayMovements = isSuperAdmin
      ? derivedMovements
      : derivedMovements.filter(m => m.warehouseId === currentWarehouseId);

    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardView
            warehouses={displayWarehouses}
            products={derivedProducts}
            stocks={displayStocks}
            transfers={displayTransfers}
            onNavigateToView={setActiveTab}
            currentUserRole={currentRole}
            currentWarehouseId={currentWarehouseId}
            onDeleteProduct={handleDeleteProduct}
            onReconcileStock={reconcileStockBalances}
            movements={displayMovements}
          />
        );
      case 'warehouses':
        return (
          <WarehouseView
            warehouses={displayWarehouses}
            onAddWarehouse={handleAddWarehouse}
            onUpdateWarehouse={handleUpdateWarehouse}
            onDeleteWarehouse={handleDeleteWarehouse}
            currentUserRole={currentRole}
          />
        );
      case 'products':
        return (
          <ProductView
            products={derivedProducts}
            customers={derivedCustomers}
            warehouses={derivedWarehouses}
            onAddProduct={handleAddProduct}
            onAddProductsBulk={handleAddProductsBulk}
            onUpdateProduct={handleUpdateProduct}
            onDeleteProduct={handleDeleteProduct}
            currentUserRole={currentRole}
            onLogAudit={logAudit}
          />
        );
      case 'customers':
        return (
          <CustomerView
            customers={derivedCustomers}
            onAddCustomer={handleAddCustomer}
            onAddCustomersBulk={handleAddCustomersBulk}
            onUpdateCustomer={handleUpdateCustomer}
            onDeleteCustomer={handleDeleteCustomer}
            currentUserRole={currentRole}
            onLogAudit={logAudit}
          />
        );
      case 'dispatches':
        return (
          <CustomerDispatchView
            outwards={displayOutwards}
            products={derivedProducts}
            warehouses={derivedWarehouses}
            stocks={displayStocks}
            customers={derivedCustomers}
            onAddOutward={handleAddOutward}
            onDeleteOutward={handleDeleteOutward}
            onRearrangeSeries={handleRearrangeDispatchSeries}
            currentUserRole={currentRole}
            currentWarehouseId={currentWarehouseId}
          />
        );
      case 'stocks':
        return (
          <StockView
            stocks={displayStocks}
            products={derivedProducts}
            warehouses={derivedWarehouses}
            currentWarehouseId={currentWarehouseId}
            currentUserRole={currentRole}
          />
        );
      case 'transfers':
        return (
          <TransferView
            transfers={displayTransfers}
            products={derivedProducts}
            warehouses={derivedWarehouses}
            stocks={derivedStocks}
            onAddTransfer={handleAddTransfer}
            onUpdateTransferStatus={handleUpdateTransferStatus}
            onEditTransfer={handleEditTransfer}
            onUndoTransfer={handleUndoTransfer}
            onDeleteTransfer={handleDeleteTransfer}
            onRearrangeSeries={handleRearrangeTransferSeries}
            currentUserRole={currentRole}
            currentWarehouseId={currentWarehouseId}
          />
        );
      case 'adjustment':
        return (
          <StockAdjustmentView
            products={derivedProducts}
            warehouses={derivedWarehouses}
            stocks={derivedStocks}
            movements={displayMovements}
            onPostAdjustment={handlePostAdjustment}
            onRevertAdjustment={handleRevertAdjustment}
            currentUserRole={currentRole}
          />
        );
      case 'ledger':
        return (
          <StockLedgerView
            movements={displayMovements}
            auditLogs={derivedAuditLogs}
            onPurgeAllData={handlePurgeAllData}
            onReverseMovement={handleReverseMovement}
            onRevertAdjustment={handleRevertAdjustment}
            onReconcileStock={reconcileStockBalances}
            onDeleteProduct={handleDeleteProduct}
            currentUserRole={currentRole}
            currentUserName={currentUserName}
            products={derivedProducts}
            warehouses={derivedWarehouses}
            stocks={derivedStocks}
            exceptions={exceptions}
            onResolveException={handleResolveException}
            onMarkExceptionUnderReview={handleMarkExceptionUnderReview}
            lastReport={lastReconciliationReport}
            onNavigateToAdjustment={() => setActiveTab('adjustment')}
          />
        );
      case 'reports':
        return (
          <ReportsView
            products={derivedProducts}
            stocks={displayStocks}
            transfers={displayTransfers}
          />
        );
      case 'stock_report':
        return (
          <StockReportView
            products={derivedProducts}
            movements={derivedMovements}
            currentWarehouseId={currentWarehouseId}
            warehouses={derivedWarehouses}
            stocks={displayStocks}
            onReconcileStock={reconcileStockBalances}
          />
        );
      case 'settings':
        return (
          <SettingsView
            currentUserRole={currentRole}
            currentUserName={currentUserName}
            currentUserUid={currentUserUid}
            users={users}
            warehouses={derivedWarehouses}
            onRemoveUser={handleDeleteUser}
            onUpdateUser={handleUpdateUser}
            onLogAudit={logAudit}
            theme={theme}
            onToggleTheme={handleToggleTheme}
          />
        );
      default:
        return <div className="text-gray-500 font-semibold p-8 text-center text-xs">Page View is offline.</div>;
    }
  };

  const activeWh = derivedWarehouses.find(w => w.code === currentWarehouseId);
  const isSecondaryWarehouse = activeWh ? !activeWh.isPrimary : false;

  // Automatically switch tab if Customer Dispatches is active but warehouse is changed to a Primary Warehouse,
  // or if non-admin tries to view restricted tabs (ledger, reports, settings)
  useEffect(() => {
    if (activeTab === 'dispatches' && derivedWarehouses.length > 0 && !isSecondaryWarehouse) {
      setActiveTab('dashboard');
    }
    if ((activeTab === 'ledger' || activeTab === 'reports' || activeTab === 'settings') && currentRole !== 'Super Admin') {
      setActiveTab('dashboard');
    }
  }, [activeTab, isSecondaryWarehouse, derivedWarehouses.length, currentRole]);

  // Sidebar navigation menu items
  const menuItems = [
    { id: 'dashboard', label: 'Overview Dashboard', icon: BarChart, color: 'text-indigo-600' },
    { id: 'warehouses', label: 'Warehouses Master', icon: WhIcon, color: 'text-indigo-500' },
    { id: 'products', label: 'Products Catalog', icon: ShoppingBag, color: 'text-indigo-500' },
    { id: 'customers', label: 'Customer Master', icon: Users, color: 'text-indigo-500' },
    ...(isSecondaryWarehouse ? [{ id: 'dispatches', label: 'Customer Dispatches', icon: Send, color: 'text-amber-500' }] : []),
    { id: 'stocks', label: 'Live Stock Ledger', icon: Layers, color: 'text-emerald-600' },
    { id: 'transfers', label: 'Stock Transfers', icon: ArrowLeftRight, color: 'text-sky-500' },
    { id: 'adjustment', label: 'Overrides & Adjustments', icon: Wrench, color: 'text-rose-500' },
    { id: 'stock_report', label: 'Stock In/Out Summary', icon: TrendingUp, color: 'text-teal-600' },
    ...(currentRole === 'Super Admin' ? [
      { id: 'ledger', label: 'Immutable Audit Trail', icon: ClipboardList, color: 'text-slate-600' },
      { id: 'reports', label: 'Strategic Analytics', icon: BarChart, color: 'text-violet-600' },
      { id: 'settings', label: 'System Settings', icon: ShieldCheck, color: 'text-emerald-600' }
    ] : []),
  ];

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center font-sans text-slate-100 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.15),transparent_70%)] pointer-events-none" />
        <div className="flex flex-col items-center gap-6 relative z-10">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: [0.95, 1.05, 0.95], opacity: 1 }}
            transition={{
              scale: { repeat: Infinity, duration: 3, ease: "easeInOut" },
              opacity: { duration: 0.8 }
            }}
            className="w-20 h-20 bg-slate-900 rounded-2xl p-1 border border-indigo-500/30 flex items-center justify-center shadow-2xl shadow-indigo-500/20"
          >
            <img
              src={stockflowLogo}
              alt="StockFlow Secure"
              className="w-full h-full object-cover rounded-xl"
              referrerPolicy="no-referrer"
            />
          </motion.div>
          <div className="flex flex-col items-center gap-2 text-center">
            <h2 className="text-md font-bold tracking-widest text-white uppercase italic">
              STOCK<span className="text-indigo-400">FLOW</span>
            </h2>
            <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-full mt-2">
              <div className="w-2 h-2 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-[10px] font-bold tracking-wide text-indigo-400 uppercase">Verifying secure credentials...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginScreen warehouses={warehouses} authErrorMessage={authErrorMessage} onLocalLogin={handleLocalLogin} />;
  }

  return (
    <div className="h-screen max-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col font-sans text-slate-800 dark:text-slate-100 antialiased selection:bg-indigo-100 dark:selection:bg-indigo-950/50 overflow-hidden">
      
      {/* Top Navigation Control bar */}
      <header className="sticky top-0 z-40 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 px-4 sm:px-6 h-16 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          {/* Mobile menu toggle */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-slate-500 hover:text-slate-800 h-11 w-11 flex items-center justify-center rounded-xl cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
            aria-label="Open menu"
            title="Toggle Mobile Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </motion.button>

          {/* Desktop menu toggle (Hide and Unhide Main Menu) */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setDesktopMenuOpen(!desktopMenuOpen)}
            className="hidden md:flex text-slate-500 hover:text-slate-800 h-11 w-11 items-center justify-center rounded-xl cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
            aria-label="Toggle main menu"
            title="Hide/Unhide Main Menu"
          >
            {desktopMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </motion.button>
          
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-800 shadow-sm bg-slate-900">
              <img
                src={stockflowLogo}
                alt="Stockflow Logo"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100 italic leading-none">
                STOCK<span className="text-indigo-600">FLOW</span>
              </h1>
              <span className="text-[8px] sm:text-[9px] font-bold text-indigo-600 tracking-wider block mt-0.5 uppercase truncate max-w-[120px] sm:max-w-none">
                {activeWh?.name.replace(' Warehouse', '').replace(' Depot', '').replace(' Fulfillment Center', '') || 'Enterprise ERP'}
              </span>
            </div>
          </div>
        </div>

        {/* Real-time status indicators */}
        <div className="hidden lg:flex items-center gap-3 text-[10px] font-mono">
          <span className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            LIVE CLOUD SYNC
          </span>
          <span className="bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800 font-bold">
            WH-CONTEXT: {currentWarehouseId}
          </span>
        </div>

        {/* Global actions */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Quick Theme Toggle Switch */}
          <ThemeToggle
            theme={theme}
            onToggleTheme={handleToggleTheme}
            variant="switch"
            showLabels={false}
          />
          
          {/* Notification Bell Dropdown */}
          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setNotificationOpen(!notificationOpen)}
              className="relative p-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer flex items-center justify-center bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {notifications.filter(n => n.status === 'unread').length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-600 text-[9px] font-black text-white rounded-full flex items-center justify-center animate-pulse">
                  {notifications.filter(n => n.status === 'unread').length}
                </span>
              )}
            </motion.button>

            <AnimatePresence>
              {notificationOpen && (
                <>
                  {/* Invisible Backdrop to close dropdown */}
                  <div className="fixed inset-0 z-40" onClick={() => setNotificationOpen(false)} />
                  
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden font-sans"
                  >
                    <div className="p-3.5 border-b border-slate-100 dark:border-slate-900 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <strong className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">Enterprise Alerts</strong>
                        <span className="text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full">
                          {notifications.filter(n => n.status === 'unread').length} unread
                        </span>
                      </div>
                      {notifications.filter(n => n.status === 'unread').length > 0 && (
                        <button
                          onClick={handleMarkAllNotificationsAsRead}
                          className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                        >
                          Mark all as read
                        </button>
                      )}
                    </div>

                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-900/60">
                      {notifications.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-xs font-medium">
                          No notifications found.
                        </div>
                      ) : (
                        notifications.map((ntf) => {
                          const isUnread = ntf.status === 'unread';
                          return (
                            <div
                              key={ntf.id}
                              className={`p-3.5 flex gap-3 items-start transition-colors relative group ${
                                isUnread ? 'bg-indigo-50/25 dark:bg-indigo-950/10' : 'hover:bg-slate-50 dark:hover:bg-slate-900/30'
                              }`}
                            >
                              {/* Colored Status indicator bar on the left */}
                              {isUnread && (
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-600" />
                              )}

                              {/* Icon corresponding to notification type */}
                              <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                                ntf.type === 'received' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400' :
                                ntf.type === 'pending_transfer' || ntf.type === 'approval_required' ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400' :
                                ntf.type === 'adjustment' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400' :
                                ntf.type === 'low_stock' || ntf.type === 'out_of_stock' ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' :
                                'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400'
                              }`}>
                                {ntf.type === 'received' ? <Inbox className="w-3.5 h-3.5" /> :
                                 ntf.type === 'pending_transfer' || ntf.type === 'approval_required' ? <ArrowLeftRight className="w-3.5 h-3.5" /> :
                                 ntf.type === 'adjustment' ? <Wrench className="w-3.5 h-3.5" /> :
                                 ntf.type === 'low_stock' || ntf.type === 'out_of_stock' ? <AlertCircle className="w-3.5 h-3.5" /> :
                                 <ClipboardList className="w-3.5 h-3.5" />}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-1.5">
                                  <h4 className={`text-xs ${isUnread ? 'font-bold text-slate-900 dark:text-slate-100' : 'font-semibold text-slate-700 dark:text-slate-300'}`}>
                                    {ntf.title}
                                  </h4>
                                  <span className="text-[8px] font-mono text-slate-400 dark:text-slate-500 shrink-0 mt-0.5">
                                    {new Date(ntf.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal mt-1">
                                  {ntf.message}
                                </p>
                                
                                <div className="flex items-center gap-3 mt-1.5">
                                  <span className="text-[8px] font-mono text-slate-400 dark:text-slate-500">
                                    {new Date(ntf.createdAt).toLocaleDateString()}
                                  </span>
                                  {isUnread && (
                                    <button
                                      onClick={() => handleMarkNotificationAsRead(ntf.id!)}
                                      className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                                    >
                                      <Check className="w-2.5 h-2.5" /> Mark read
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Delete button */}
                              <button
                                onClick={() => handleDeleteNotification(ntf.id!)}
                                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-opacity p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/20 cursor-pointer self-start -mt-1 -mr-1"
                                title="Delete Notification"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* User Profile Info */}
          <div className="flex items-center gap-3 border-l border-slate-200 dark:border-slate-800 pl-4">
            <div className="text-right leading-none hidden sm:block">
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">{currentUserName}</p>
              <p className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest mt-1">{currentRole}</p>
            </div>
            <div className="w-9 h-9 bg-slate-100 dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-800 flex items-center justify-center font-bold text-slate-600 dark:text-slate-400 text-xs shadow-inner">
              {currentRole === 'Super Admin' ? 'SA' : currentRole === 'Store Operator' ? 'SO' : 'VW'}
            </div>
            <button
              onClick={handleLogout}
              title="Disconnect Warehouse Terminal"
              className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors cursor-pointer flex items-center justify-center"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main layout frame */}
      <div className="flex-1 flex relative overflow-hidden pb-16 md:pb-0">
        
        {/* Mobile Swipe-to-Close Drawer and Backdrop using Framer Motion */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <>
              {/* Backdrop overlay for mobile menu */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="md:hidden fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-40 cursor-pointer"
                onClick={() => setMobileMenuOpen(false)}
              />
              
              {/* Sidebar Frame - responsive sliding with swipe dismiss */}
              <motion.aside 
                drag="x"
                dragConstraints={{ left: -280, right: 0 }}
                dragElastic={0.15}
                onDragEnd={(e, info) => {
                  if (info.offset.x < -80 || info.velocity.x < -400) {
                    setMobileMenuOpen(false);
                  }
                }}
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 240 }}
                className="md:hidden fixed inset-y-0 left-0 w-72 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 flex flex-col justify-between p-5 z-50 shadow-2xl"
              >
                <div className="space-y-6 overflow-y-auto pr-1">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-900 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-800 shadow-xs bg-slate-900">
                        <img
                          src={stockflowLogo}
                          alt="Stockflow Logo"
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <span className="text-sm font-bold tracking-tight italic text-slate-800 dark:text-slate-100">STOCKFLOW Drawer</span>
                    </div>
                    <button 
                      onClick={() => setMobileMenuOpen(false)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Active Operator metadata card */}
                  <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-7 h-7 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-bold text-xs flex items-center justify-center">
                        {currentRole.slice(0, 1)}
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Operator ({currentRole.slice(0, 5)}...)</span>
                        <strong className="text-xs font-bold text-slate-800 dark:text-slate-200 block truncate">{currentUserName}</strong>
                      </div>
                    </div>
                    {currentRole === 'Super Admin' && (
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                        Warehouse context:
                        <select
                          value={currentWarehouseId}
                          onChange={(e) => setCurrentWarehouseId(e.target.value)}
                          className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg px-2 py-1.5 mt-1 font-sans focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {derivedWarehouses.map((wh, idx) => (
                            <option key={`${wh.id || wh.code}-${idx}`} value={wh.code}>{wh.name} ({wh.code})</option>
                          ))}
                        </select>
                      </div>
                    )}
                    
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full mt-3 flex items-center justify-center gap-1.5 bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-rose-700 dark:text-rose-400 font-bold py-2 px-3 rounded-lg text-xs transition-colors border border-rose-200 dark:border-rose-900/50 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Disconnect Terminal</span>
                    </button>
                  </div>

                  {/* Menu Links with Larger Mobile Touch Targets */}
                  <nav className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block px-2 mb-2.5">Main Menu</span>
                    {menuItems.map((item) => {
                      const IconComp = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setActiveTab(item.id);
                            setMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold text-left transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-bold border-l-4 border-indigo-600 dark:border-indigo-500'
                              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <IconComp className={`w-4.5 h-4.5 shrink-0 ${isActive ? 'text-indigo-600' : item.color}`} />
                            {item.label}
                          </span>

                          {/* Pending transfers indicator badge */}
                          {item.id === 'transfers' && transfers.filter(t => t.status === 'Pending Approval').length > 0 && (
                            <span className="text-[10px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full">
                              {transfers.filter(t => t.status === 'Pending Approval').length}
                            </span>
                          )}

                      {/* Low stock alerts indicator badge */}
                      {item.id === 'stocks' && (() => {
                        const lowCount = currentWarehouseId
                          ? stocks.filter(s => {
                              if (s.warehouseId !== currentWarehouseId) return false;
                              if (isDerabassi(s.warehouseName, s.warehouseId)) return false;
                              const prod = products.find(p => p.itemCode === s.itemCode);
                              const liveAvailable = getLiveAvailableQty(s, warehouses);
                              return prod ? liveAvailable > 0 && liveAvailable <= prod.minStock : false;
                            }).length
                          : products.filter(p => {
                              const pStocks = stocks.filter(s => s.itemCode === p.itemCode && !isDerabassi(s.warehouseName, s.warehouseId));
                              const tot = pStocks.reduce((sum, s) => sum + getLiveAvailableQty(s, warehouses), 0);
                              return tot > 0 && tot <= p.minStock;
                            }).length;

                        if (lowCount === 0) return null;
                        return (
                          <span className="text-[10px] font-bold bg-rose-500 text-white px-2 py-0.5 rounded-full">
                            {lowCount}
                          </span>
                        );
                      })()}
                        </button>
                      );
                    })}
                  </nav>
                </div>

                {/* Swipe Dismiss Instruction */}
                <div className="mt-auto pt-4 border-t border-slate-100 dark:border-slate-900 text-center">
                  <p className="text-[10px] font-semibold text-slate-400">← Swipe left to close</p>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Desktop Sidebar Frame - visible when open */}
        {desktopMenuOpen && (
          <aside className="hidden md:flex w-64 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 flex flex-col justify-between p-4 z-30 shrink-0">
            <div className="space-y-6 overflow-y-auto pr-1">
              {/* Active Operator metadata card */}
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-3.5">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-7 h-7 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-bold text-xs flex items-center justify-center">
                    {currentRole.slice(0, 1)}
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Operator ({currentRole.slice(0, 5)}...)</span>
                    <strong className="text-xs font-bold text-slate-800 dark:text-slate-200 block truncate">{currentUserName}</strong>
                  </div>
                </div>
                {currentRole === 'Super Admin' && (
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                    Warehouse context:
                    <select
                      value={currentWarehouseId}
                      onChange={(e) => setCurrentWarehouseId(e.target.value)}
                      className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded px-2 py-1 mt-1 font-sans focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {derivedWarehouses.map((wh, idx) => (
                        <option key={`${wh.id || wh.code}-${idx}`} value={wh.code}>{wh.name} ({wh.code})</option>
                      ))}
                    </select>
                  </div>
                )}
                
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full mt-3 flex items-center justify-center gap-1.5 bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-rose-700 dark:text-rose-400 font-bold py-1.5 px-3 rounded text-[10px] transition-colors border border-rose-200 dark:border-rose-900/50 cursor-pointer"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Disconnect Terminal</span>
                </button>
              </div>

              {/* Menu Links */}
              <nav className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block px-2 mb-3">Main Menu</span>
                {menuItems.map((item) => {
                  const IconComp = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs font-semibold text-left transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-bold border-l-2 border-indigo-600 dark:border-indigo-500'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <IconComp className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-600' : item.color}`} />
                        {item.label}
                      </span>

                      {/* Pending transfers indicator badge */}
                      {item.id === 'transfers' && transfers.filter(t => t.status === 'Pending Approval').length > 0 && (
                        <span className="text-[9px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded">
                          {transfers.filter(t => t.status === 'Pending Approval').length}
                        </span>
                      )}

                      {/* Low stock alerts indicator badge */}
                      {item.id === 'stocks' && (() => {
                        const lowCount = currentWarehouseId
                          ? stocks.filter(s => {
                              if (s.warehouseId !== currentWarehouseId) return false;
                              if (isDerabassi(s.warehouseName, s.warehouseId)) return false;
                              const prod = products.find(p => p.itemCode === s.itemCode);
                              const liveAvailable = getLiveAvailableQty(s, warehouses);
                              return prod ? liveAvailable > 0 && liveAvailable <= prod.minStock : false;
                            }).length
                          : products.filter(p => {
                              const pStocks = stocks.filter(s => s.itemCode === p.itemCode && !isDerabassi(s.warehouseName, s.warehouseId));
                              const tot = pStocks.reduce((sum, s) => sum + getLiveAvailableQty(s, warehouses), 0);
                              return tot > 0 && tot <= p.minStock;
                            }).length;

                        if (lowCount === 0) return null;
                        return (
                          <span className="text-[9px] font-bold bg-rose-500 text-white px-2 py-0.5 rounded">
                            {lowCount}
                          </span>
                        );
                      })()}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Cloud Sync Status widget & Offline Backup/Sync Controller */}
            <div className="mt-auto pt-4 border-t border-slate-100 dark:border-slate-900">
              <div className="p-3 bg-slate-900 dark:bg-slate-950 border border-slate-800 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">Cloud Sync Status</p>
                  {isOnline ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                      <Wifi className="w-3 h-3" /> Online
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium">
                      <WifiOff className="w-3 h-3" /> Offline Mode
                    </span>
                  )}
                </div>

                {/* Offline Queue Tracker */}
                {offlineQueue.length > 0 ? (
                  <div className="p-2 bg-slate-950/40 border border-slate-800 rounded space-y-1.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400 font-medium">Pending Sync:</span>
                      <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded-full font-mono font-bold">
                        {offlineQueue.length} tx
                      </span>
                    </div>

                    {isSyncing ? (
                      <div className="flex items-center gap-1 text-[10px] text-sky-400 font-mono">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Uploading to cloud...</span>
                      </div>
                    ) : isOnline ? (
                      <button
                        onClick={syncPendingTransactions}
                        className="w-full py-1 px-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-[10px] font-semibold rounded shadow transition flex items-center justify-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" /> Push Pending Items
                      </button>
                    ) : (
                      <p className="text-[9px] text-slate-500 font-mono leading-tight">
                        Queue locked. Auto-syncing when web connection returns...
                      </p>
                    )}

                    {syncError && (
                      <p className="text-[9px] text-rose-400 font-mono leading-tight mt-1">
                        Error: {syncError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 p-1">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse inline-block"></span>
                    <span className="text-[10px] font-semibold text-slate-300">All databases synchronized</span>
                  </div>
                )}

                {/* Emergency Local Backup (Answers User's Data Recovery Query) */}
                <button
                  onClick={() => {
                    try {
                      const backupData = {
                        backupTimestamp: new Date().toISOString(),
                        environment: 'StockFlow ERP Offline Cache',
                        user: `${currentUserName} (${currentRole})`,
                        collections: {
                          warehouses: JSON.parse(localStorage.getItem('stockflow_cache_warehouses') || '[]'),
                          products: JSON.parse(localStorage.getItem('stockflow_cache_products') || '[]'),
                          stocks: JSON.parse(localStorage.getItem('stockflow_cache_stocks') || '[]'),
                          inwards: JSON.parse(localStorage.getItem('stockflow_cache_inwards') || '[]'),
                          outwards: JSON.parse(localStorage.getItem('stockflow_cache_outwards') || '[]'),
                          transfers: JSON.parse(localStorage.getItem('stockflow_cache_transfers') || '[]'),
                          movements: JSON.parse(localStorage.getItem('stockflow_cache_movements') || '[]'),
                          suppliers: JSON.parse(localStorage.getItem('stockflow_cache_suppliers') || '[]'),
                          customers: JSON.parse(localStorage.getItem('stockflow_cache_customers') || '[]'),
                          users,
                          offlineQueue
                        }
                      };
                      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `stockflow-emergency-backup-${new Date().toISOString().slice(0, 10)}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err: any) {
                      alert('Export failed: ' + err.message);
                    }
                  }}
                  className="w-full py-1 px-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 text-[9px] font-medium rounded border border-slate-700/80 hover:border-slate-600 transition flex items-center justify-center gap-1"
                  title="Download local databases & offline queues to recover in case of browser/device crash"
                >
                  <ClipboardList className="w-3 h-3" /> Recover / Backup Offline Data
                </button>
              </div>
              <div className="text-center mt-3">
                <span className="text-[9px] text-slate-400 font-mono block">STOCKFLOW ERP v4.3.0 (Offline-Ready)</span>
              </div>
            </div>
          </aside>
        )}

        {/* View stage wrapper with animated route transitions */}
        <main className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-900 p-4 md:p-8 space-y-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="w-full h-full"
            >
              {renderActiveView()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 flex justify-around items-center z-40 px-2 pb-safe shadow-lg">
        {[
          { id: 'dashboard', label: 'Overview', icon: BarChart },
          { id: 'products', label: 'Catalog', icon: ShoppingBag },
          { id: 'stocks', label: 'Live Stock', icon: Layers },
          { id: 'transfers', label: 'Transfers', icon: ArrowLeftRight },
          { id: 'menu_toggle', label: 'More', icon: Menu }
        ].map((item) => {
          const IconComponent = item.icon;
          const isSelected = activeTab === item.id;
          const isMenuToggler = item.id === 'menu_toggle';

          return (
            <motion.button
              key={item.id}
              whileTap={{ scale: 0.90 }}
              onClick={() => {
                if (isMenuToggler) {
                  setMobileMenuOpen(true);
                } else {
                  setActiveTab(item.id);
                }
              }}
              className="flex-1 flex flex-col items-center justify-center h-full relative cursor-pointer"
            >
              {/* Highlight background pill for active tab */}
              {isSelected && !isMenuToggler && (
                <motion.div
                  layoutId="mobileActiveTabIndicator"
                  className="absolute inset-x-2 inset-y-1 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/40 -z-10"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}

              <IconComponent 
                className={`w-5.5 h-5.5 transition-colors ${
                  isSelected && !isMenuToggler 
                    ? 'text-indigo-600' 
                    : isMenuToggler && mobileMenuOpen 
                    ? 'text-indigo-600' 
                    : 'text-slate-400'
                }`} 
              />
              <span 
                className={`text-[9px] font-bold mt-1 tracking-tight transition-colors ${
                  isSelected && !isMenuToggler 
                    ? 'text-indigo-600 font-extrabold' 
                    : isMenuToggler && mobileMenuOpen 
                    ? 'text-indigo-600 font-extrabold' 
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {item.label}
              </span>

              {/* Dynamic badge for pending items inside the bottom tab bar */}
              {item.id === 'transfers' && transfers.filter(t => t.status === 'Pending Approval').length > 0 && (
                <span className="absolute top-2.5 right-6 text-[8px] font-extrabold bg-amber-500 text-white min-w-4 h-4 rounded-full flex items-center justify-center px-1">
                  {transfers.filter(t => t.status === 'Pending Approval').length}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* FOOTER STATUS BAR - hidden on mobile to prevent overlapping */}
      <footer className="hidden md:flex h-8 bg-slate-100 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 items-center justify-between px-6 shrink-0 z-40">
        <div className="flex items-center gap-4 text-[10px] font-medium text-slate-500 dark:text-slate-400">
          {isOnline ? (
            <span className="flex items-center gap-1 uppercase tracking-tighter shrink-0 text-emerald-600 font-semibold">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div> SYSTEM LIVE
            </span>
          ) : (
            <span className="flex items-center gap-1 uppercase tracking-tighter shrink-0 text-amber-600 font-semibold">
              <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></div> OFFLINE MODE
            </span>
          )}
          <span className="shrink-0">VERSION 4.2.0-STABLE</span>
          <span className="border-l border-slate-300 dark:border-slate-700 pl-4 uppercase">IP: 192.168.1.104</span>
        </div>
        <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 italic">
          Last backup: {new Date().toISOString().slice(0, 10)} 03:00 AM UTC
        </div>
      </footer>

    </div>
  );
}
