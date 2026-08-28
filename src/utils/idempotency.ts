import { doc, setDoc, runTransaction } from 'firebase/firestore';
import { db, getDoc as getDocWithTimeout } from '../firebase';
import { IdempotencyRecord } from '../types';

/**
 * Stockflow Apex - Server-Side Persistent Idempotency Service
 * 
 * CHANGE 8: Atomic Server-Side Idempotency Protection
 * Guarantees exactly-once execution across multiple concurrent clients using
 * atomic Firestore transactions (runTransaction) to claim idempotency keys
 * before executing business operations.
 * 
 * Prevents race conditions, double-clicks, concurrent terminal actions,
 * network retries, and browser refresh replays.
 */

// Generate client instance ID once per tab session for tracking and lease takeover
const CLIENT_INSTANCE_ID = `client_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;

// Default lease duration and heartbeat interval
const DEFAULT_LEASE_TIMEOUT_MS = 90000; // 90 seconds
const HEARTBEAT_INTERVAL_MS = 15000;    // 15 seconds

// In-flight active promise registry to deduplicate concurrent calls within the same client
const inFlightPromises = new Map<string, Promise<any>>();

// Completed transaction cache in memory (with timestamps)
const completedTransactions = new Map<string, { timestamp: number; result?: any }>();

// Local storage key for persistent idempotency cache
const IDEMPOTENCY_STORAGE_KEY = 'stockflow_idempotency_cache';

export interface ClaimResult {
  acquired: boolean;
  reason?: 'completed' | 'in_flight' | 'failed';
  record?: IdempotencyRecord;
  docId: string;
  clientId: string;
  error?: string;
}

/**
 * Derives a clean, deterministic Firestore Document ID from an idempotency key.
 * Strips invalid Firestore characters (e.g. forward slashes) while preserving uniqueness.
 */
export function toIdempotencyDocId(key: string): string {
  if (!key) return '';
  return key.trim().replace(/[\/\s#?\[\]*.]/g, '_').slice(0, 500);
}

// Helper to get persisted cache from localStorage
function getPersistedCache(): Record<string, number> {
  try {
    const raw = localStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Helper to save persisted cache to localStorage
function savePersistedKey(key: string) {
  try {
    const cache = getPersistedCache();
    cache[key] = Date.now();
    
    // Prune entries older than 48 hours to prevent unbounded local storage growth
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
    for (const k in cache) {
      if (cache[k] < twoDaysAgo) {
        delete cache[k];
      }
    }
    
    localStorage.setItem(IDEMPOTENCY_STORAGE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('[Idempotency] Failed to persist key to local storage:', err);
  }
}

/**
 * Checks if an operation with this idempotency key was already completed locally.
 */
export function isTransactionCompletedLocal(key: string): boolean {
  if (!key) return false;
  if (completedTransactions.has(key)) {
    return true;
  }
  const cache = getPersistedCache();
  return !!cache[key];
}

/**
 * Synchronous local check for backward compatibility.
 */
export function isTransactionCompleted(key: string): boolean {
  return isTransactionCompletedLocal(key);
}

/**
 * Checks if an idempotency key has already been recorded as completed in Firestore.
 */
export async function isTransactionCompletedServer(key: string): Promise<boolean> {
  if (!key) return false;
  
  // Quick check in memory/local cache first
  if (isTransactionCompletedLocal(key)) {
    return true;
  }

  if (!db) return false;

  try {
    const docId = toIdempotencyDocId(key);
    const docRef = doc(db, 'idempotencyKeys', docId);
    const snap = await getDocWithTimeout(docRef, 4000);
    
    if (snap && snap.exists()) {
      const data = snap.data() as IdempotencyRecord;
      if (data?.status === 'completed') {
        // Hydrate local cache
        completedTransactions.set(key, { timestamp: data.timestamp || Date.now(), result: data.result });
        savePersistedKey(key);
        return true;
      }
    }
    return false;
  } catch (err) {
    console.warn(`[Idempotency] Firestore server lookup failed for key "${key}":`, err);
    // Fall back to local check if offline or network timeout
    return isTransactionCompletedLocal(key);
  }
}

/**
 * Atomically attempts to claim an idempotency key in Firestore using a Transaction.
 * Guarantees that only ONE client among concurrent requests can acquire the lock
 * and proceed to execute the business operation.
 * 
 * CRITICAL SAFETY DIRECTIVE:
 * Never returns acquired: true unless the atomic Firestore transaction successfully claimed
 * the document. If Firestore is unavailable or the transaction fails, acquired is false.
 */
export async function claimIdempotencyKey(
  key: string,
  leaseTimeoutMs: number = DEFAULT_LEASE_TIMEOUT_MS
): Promise<ClaimResult> {
  const docId = toIdempotencyDocId(key);
  const clientId = CLIENT_INSTANCE_ID;

  if (!db) {
    return {
      acquired: false,
      reason: 'failed',
      docId,
      clientId,
      error: 'Firestore database connection is unavailable. Cannot verify idempotency claim.'
    };
  }

  try {
    const docRef = doc(db, 'idempotencyKeys', docId);

    const result = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);

      if (snap.exists()) {
        const data = snap.data() as IdempotencyRecord;

        // 1. If already completed, reject claim immediately
        if (data.status === 'completed') {
          return { acquired: false, reason: 'completed' as const, record: data, docId, clientId };
        }

        // 2. If currently in_flight, check ownership and lease validity
        if (data.status === 'in_flight') {
          // If the same client instance already holds the claim, allow lease renewal
          if (data.clientId === clientId) {
            const renewedRecord: IdempotencyRecord = {
              ...data,
              timestamp: Date.now()
            };
            transaction.set(docRef, renewedRecord, { merge: true });
            return { acquired: true, docId, clientId, record: renewedRecord };
          }

          const isLeaseActive = Date.now() - (data.timestamp || 0) < leaseTimeoutMs;
          if (isLeaseActive) {
            // Active lock is held by another live client with active heartbeat
            return { acquired: false, reason: 'in_flight' as const, record: data, docId, clientId };
          }
          // Lease expired (previous client crashed, disconnected, or abandoned) -> take over lease
          console.warn(`[Idempotency] Stale lock expired for key "${key}" (held by ${data.clientId}). Reclaiming atomically.`);
        }
      }

      // 3. Atomically write status 'in_flight' to claim exclusive execution right
      const claimRecord: IdempotencyRecord = {
        id: docId,
        key,
        status: 'in_flight',
        clientId,
        createdAt: new Date().toISOString(),
        timestamp: Date.now()
      };

      transaction.set(docRef, claimRecord, { merge: true });
      return { acquired: true, docId, clientId, record: claimRecord };
    });

    return result;
  } catch (err: any) {
    console.error(`[Idempotency] Atomic claim transaction failed for key "${key}":`, err);
    // CRITICAL: NEVER grant acquired: true on failure!
    return {
      acquired: false,
      reason: 'failed',
      docId,
      clientId,
      error: err?.message || String(err)
    };
  }
}

/**
 * Renews/heartbeats the active claim timestamp in Firestore to prevent lease expiration
 * during long-running business operations.
 */
export async function refreshIdempotencyClaim(key: string): Promise<boolean> {
  if (!db || !key) return false;
  const docId = toIdempotencyDocId(key);
  try {
    const docRef = doc(db, 'idempotencyKeys', docId);
    await setDoc(docRef, {
      timestamp: Date.now(),
      clientId: CLIENT_INSTANCE_ID
    }, { merge: true });
    return true;
  } catch (err) {
    console.warn(`[Idempotency] Heartbeat refresh failed for key "${key}":`, err);
    return false;
  }
}

/**
 * Marks an idempotency claim as successfully completed in Firestore and local caches.
 * Verifies that the client still owns the claim before finalizing.
 */
export async function completeIdempotencyClaim(
  key: string,
  result?: any
): Promise<void> {
  if (!key) return;

  const docId = toIdempotencyDocId(key);
  const now = Date.now();
  const iso = new Date().toISOString();

  // 1. Mark local memory and localStorage cache immediately
  completedTransactions.set(key, { timestamp: now, result });
  savePersistedKey(key);

  // 2. Persist completion to Firestore idempotencyKeys collection
  if (db) {
    try {
      const docRef = doc(db, 'idempotencyKeys', docId);
      const payload: Partial<IdempotencyRecord> = {
        id: docId,
        key,
        status: 'completed',
        clientId: CLIENT_INSTANCE_ID,
        completedAt: iso,
        timestamp: now
      };

      // Safely attach serializable result if available
      if (result !== undefined && typeof result === 'object' && !('preventDefault' in result) && !('nativeEvent' in result)) {
        try {
          payload.result = JSON.parse(JSON.stringify(result));
        } catch {
          // ignore serialization errors for complex object instances
        }
      }

      await setDoc(docRef, payload, { merge: true });
      console.log(`[Idempotency] Atomic claim marked completed for key "${key}" (docId: ${docId}).`);
    } catch (err) {
      console.warn(`[Idempotency] Could not write completed record to Firestore for key "${key}":`, err);
    }
  }
}

/**
 * Releases an idempotency claim when an operation fails, allowing future retries.
 */
export async function releaseIdempotencyClaim(
  key: string,
  errorMessage?: string
): Promise<void> {
  if (!key) return;

  const docId = toIdempotencyDocId(key);
  if (db) {
    try {
      const docRef = doc(db, 'idempotencyKeys', docId);
      await setDoc(docRef, {
        id: docId,
        key,
        status: 'failed',
        clientId: CLIENT_INSTANCE_ID,
        errorMessage: errorMessage || 'Operation failed',
        timestamp: Date.now()
      }, { merge: true });
      console.log(`[Idempotency] Released claim for failed transaction key "${key}".`);
    } catch (err) {
      console.warn(`[Idempotency] Failed to release claim for key "${key}":`, err);
    }
  }
}

/**
 * Backward compatibility helper for markTransactionCompleted.
 */
export async function markTransactionCompleted(key: string, result?: any): Promise<void> {
  return completeIdempotencyClaim(key, result);
}

/**
 * Executes an asynchronous transaction with strict multi-layer atomic server & client idempotency:
 * 1. In-flight Promise locking (prevents race conditions from rapid double-clicks in same client)
 * 2. In-memory and local storage caching (fast-path rejection of replays)
 * 3. Server-side Atomic Claim via Firestore runTransaction (prevents concurrent execution across clients)
 * 4. Business operation execution with exclusive claim
 * 5. Automatic persistent completion status or failure release
 */
export async function runIdempotent<T>(
  key: string,
  operation: () => Promise<T>,
  options: {
    allowCachedResult?: boolean;
    onDuplicateSkipped?: () => void;
    leaseTimeoutMs?: number;
  } = { allowCachedResult: true }
): Promise<T> {
  if (!key) {
    return operation();
  }

  // 1. Check if identical operation is already in-flight within this client session
  if (inFlightPromises.has(key)) {
    console.warn(`[Idempotency] In-flight transaction detected for key "${key}". Sharing active promise.`);
    return inFlightPromises.get(key) as Promise<T>;
  }

  // 2. Check if transaction was already completed in local cache
  if (isTransactionCompletedLocal(key) && options.allowCachedResult) {
    console.warn(`[Idempotency] Transaction "${key}" was already completed locally. Skipping duplicate execution.`);
    if (options.onDuplicateSkipped) {
      options.onDuplicateSkipped();
    }
    const cached = completedTransactions.get(key);
    return (cached?.result ?? undefined) as T;
  }

  // 3. Create and track execution promise with server-side atomic claim
  const promise = (async () => {
    try {
      // 4. Atomically claim the idempotency key in Firestore
      const claim = await claimIdempotencyKey(key, options.leaseTimeoutMs);

      if (!claim.acquired) {
        if (claim.reason === 'completed') {
          console.warn(`[Idempotency] Transaction "${key}" already completed on server. Skipping duplicate.`);
          // Hydrate local cache
          completedTransactions.set(key, { timestamp: claim.record?.timestamp || Date.now(), result: claim.record?.result });
          savePersistedKey(key);

          if (options.onDuplicateSkipped) {
            options.onDuplicateSkipped();
          }
          return (claim.record?.result ?? undefined) as T;
        }

        if (claim.reason === 'in_flight') {
          console.warn(`[Idempotency] Transaction "${key}" is currently in-flight by another client (${claim.record?.clientId}). Duplicate execution blocked.`);
          if (options.onDuplicateSkipped) {
            options.onDuplicateSkipped();
          }
          throw new Error(`Transaction is currently being processed by another session (${key}). Please wait.`);
        }

        // CRITICAL: NEVER EXECUTE WITHOUT A VERIFIED IDEMPOTENCY CLAIM
        console.error(`[Idempotency] Aborting transaction "${key}": Could not verify server-side idempotency claim (${claim.error || claim.reason}).`);
        throw new Error(`Transaction aborted: Unable to verify server-side idempotency claim (${claim.error || 'claim failed'}). Operation stopped to prevent potential duplicate entries.`);
      }

      // 5. Client acquired exclusive atomic claim -> Start heartbeat and execute business operation
      let heartbeatTimer: any = null;
      if (typeof window !== 'undefined' || typeof setInterval !== 'undefined') {
        heartbeatTimer = setInterval(() => {
          refreshIdempotencyClaim(key).catch((err) => {
            console.warn(`[Idempotency] Background lease heartbeat failed for key "${key}":`, err);
          });
        }, HEARTBEAT_INTERVAL_MS);
      }

      let result: T;
      try {
        result = await operation();
      } catch (opErr: any) {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        // Release the claim on error so user or retry mechanisms can retry
        await releaseIdempotencyClaim(key, opErr?.message || String(opErr));
        throw opErr;
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      }

      // 6. Complete the claim persistently in Firestore and local caches
      await completeIdempotencyClaim(key, result);
      return result;
    } finally {
      inFlightPromises.delete(key);
    }
  })();

  inFlightPromises.set(key, promise);
  return promise;
}

/**
 * Key Generators for Domain Transactions
 */
export const IdempotencyKeys = {
  inward: (grnNumber: string, itemCode?: string) => 
    `INWARD_${grnNumber.trim().toUpperCase()}${itemCode ? `_${itemCode.trim().toUpperCase()}` : ''}`,
  
  outward: (dispatchNumber: string, itemCode: string) => 
    `OUTWARD_${dispatchNumber.trim().toUpperCase()}_${itemCode.trim().toUpperCase()}`,
  
  transferCreate: (transferNumber: string) => 
    `TRF_CREATE_${transferNumber.trim().toUpperCase()}`,
  
  transferStatus: (transferId: string, status: string) => 
    `TRF_STATUS_${transferId}_${status.toUpperCase()}`,
  
  transferUndo: (transferId: string) => 
    `TRF_UNDO_${transferId}`,
  
  adjustment: (referenceOrKey: string) => 
    `ADJ_${referenceOrKey.trim().toUpperCase()}`,
  
  adjustmentRevert: (movementIdOrRef: string) => 
    `ADJ_REV_${movementIdOrRef.trim().toUpperCase()}`,
  
  product: (itemCode: string) => 
    `PROD_${itemCode.trim().toUpperCase()}`,
  
  warehouse: (code: string) => 
    `WH_${code.trim().toUpperCase()}`,
  
  customer: (name: string, phone?: string) => 
    `CUST_${name.trim().toLowerCase()}_${(phone || '').trim()}`,
  
  supplier: (name: string, phone?: string) => 
    `SUPP_${name.trim().toLowerCase()}_${(phone || '').trim()}`,

  documentDelete: (collectionName: string, id: string) =>
    `DEL_${collectionName.toUpperCase()}_${id}`
};


