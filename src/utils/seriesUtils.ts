import { doc, writeBatch, Firestore, collection, getDocs } from 'firebase/firestore';
import { Outward, Transfer, Inward, StockMovement, Product, Warehouse, Supplier, Customer } from '../types';

/**
 * Extracts numeric value from a series string (e.g. "DSP-1003" -> 1003, "TRF-2026-005" -> 5)
 */
export function extractSeriesNumber(seriesStr: string, prefix: string): number | null {
  if (!seriesStr) return null;
  const regex = new RegExp(`^${prefix}[^0-9]*(\\d+)$`, 'i');
  const match = seriesStr.trim().match(regex);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  // Generic fallback if prefix differs
  const digitsMatch = seriesStr.match(/(\d+)/g);
  if (digitsMatch && digitsMatch.length > 0) {
    return parseInt(digitsMatch[digitsMatch.length - 1], 10);
  }
  return null;
}

/**
 * Generates the next guaranteed unique series number starting from baseNumber.
 * Ensures no collisions with existing active series numbers.
 */
export function generateNextUniqueSeries(
  prefix: string,
  existingSeriesNumbers: string[],
  baseNumber: number = 1001
): string {
  const cleanPrefix = prefix.endsWith('-') ? prefix : `${prefix}-`;
  const existingSet = new Set(existingSeriesNumbers.map(s => s?.trim().toUpperCase()));

  let candidateNum = baseNumber;
  // Extract all existing numbers to find the highest number if candidateNum is below max
  const existingNumbers = existingSeriesNumbers
    .map(s => extractSeriesNumber(s, cleanPrefix))
    .filter((n): n is number => n !== null);

  if (existingNumbers.length > 0) {
    const maxNum = Math.max(...existingNumbers);
    candidateNum = Math.max(baseNumber, maxNum + 1);
  }

  // Double check candidate is not in set
  while (existingSet.has(`${cleanPrefix}${candidateNum}`.toUpperCase())) {
    candidateNum++;
  }

  return `${cleanPrefix}${candidateNum}`;
}

/**
 * Validates whether a proposed series number is strictly unique.
 */
export function isSeriesUnique(
  proposedSeries: string,
  existingSeriesNumbers: string[],
  currentIdOrRef?: string
): boolean {
  if (!proposedSeries || !proposedSeries.trim()) return false;
  const target = proposedSeries.trim().toUpperCase();
  const duplicate = existingSeriesNumbers.some(
    s => s && s.trim().toUpperCase() === target && s.trim().toUpperCase() !== currentIdOrRef?.toUpperCase()
  );
  return !duplicate;
}

/**
 * Auto rearranges Outward Dispatch series numbers sequentially for DRAFT documents ONLY.
 * CRITICAL (CHANGE 11): Posted dispatch documents are IMMUTABLE historical records and MUST NEVER be altered or renumbered.
 */
export async function rearrangeDispatchSeries(
  db: Firestore | null,
  outwards: Outward[],
  movements: StockMovement[],
  baseNumber: number = 1001
): Promise<{ updatedCount: number; oldToNewMap: Record<string, string> }> {
  // Outwards in the system are posted outbound customer dispatches.
  // Filter strictly for genuine draft dispatches if any exist with a Draft status.
  const draftOutwards = outwards.filter(out => (out as any).status === 'Draft');

  if (draftOutwards.length === 0 || !db) {
    return { updatedCount: 0, oldToNewMap: {} };
  }

  // Get all existing POSTED dispatch numbers to ensure draft renumbering never collides with posted documents
  const postedDispatchNumbers = new Set(
    outwards
      .filter(out => (out as any).status !== 'Draft')
      .map(out => out.dispatchNumber?.trim().toUpperCase())
  );

  // Group draft outwards by dispatchNumber
  const groupedMap: Record<string, Outward[]> = {};
  draftOutwards.forEach(out => {
    if (!groupedMap[out.dispatchNumber]) {
      groupedMap[out.dispatchNumber] = [];
    }
    groupedMap[out.dispatchNumber].push(out);
  });

  // Sort distinct draft dispatches by date/time or original number
  const sortedDispatchNums = Object.keys(groupedMap).sort((a, b) => {
    const groupA = groupedMap[a];
    const groupB = groupedMap[b];
    const dateA = groupA[0]?.date || '';
    const dateB = groupB[0]?.date || '';
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const numA = extractSeriesNumber(a, 'DSP-') || 0;
    const numB = extractSeriesNumber(b, 'DSP-') || 0;
    return numA - numB;
  });

  const oldToNewMap: Record<string, string> = {};
  let changedCount = 0;
  let candidateNum = baseNumber;

  sortedDispatchNums.forEach((oldNum) => {
    while (postedDispatchNumbers.has(`DSP-${candidateNum}`.toUpperCase())) {
      candidateNum++;
    }
    const targetNum = `DSP-${candidateNum}`;
    if (oldNum !== targetNum) {
      oldToNewMap[oldNum] = targetNum;
      changedCount++;
    }
    candidateNum++;
  });

  if (changedCount === 0) {
    return { updatedCount: 0, oldToNewMap };
  }

  // Perform Firestore Batch Updates for DRAFTS ONLY
  const batch = writeBatch(db);

  draftOutwards.forEach(out => {
    if (out.id && oldToNewMap[out.dispatchNumber]) {
      const newNum = oldToNewMap[out.dispatchNumber];
      batch.update(doc(db, 'outwards', out.id), { dispatchNumber: newNum });
    }
  });

  await batch.commit();
  return { updatedCount: changedCount, oldToNewMap };
}

/**
 * Auto rearranges Stock Transfer series numbers sequentially for DRAFT transfers ONLY.
 * CRITICAL (CHANGE 11): Once a transfer reaches any posted/confirmed state ('Pending Approval', 'Approved', 'Dispatched', 'In Transit', 'Received', 'Closed'),
 * its transferNumber is strictly IMMUTABLE and MUST NEVER be altered or renumbered.
 */
export async function rearrangeTransferSeries(
  db: Firestore | null,
  transfers: Transfer[],
  movements: StockMovement[],
  baseNumber: number = 1001
): Promise<{ updatedCount: number; oldToNewMap: Record<string, string> }> {
  // Strictly filter for genuine DRAFT transfers ONLY
  const draftTransfers = transfers.filter(tr => tr.status === 'Draft');

  if (draftTransfers.length === 0 || !db) {
    return { updatedCount: 0, oldToNewMap: {} };
  }

  // Get all existing POSTED transfer numbers to ensure draft renumbering never collides with posted documents
  const postedTransferNumbers = new Set(
    transfers
      .filter(tr => tr.status !== 'Draft')
      .map(tr => tr.transferNumber?.trim().toUpperCase())
  );

  // Group draft transfers by transferNumber
  const groupedMap: Record<string, Transfer[]> = {};
  draftTransfers.forEach(tr => {
    if (!groupedMap[tr.transferNumber]) {
      groupedMap[tr.transferNumber] = [];
    }
    groupedMap[tr.transferNumber].push(tr);
  });

  // Sort distinct draft transfers
  const sortedTransferNums = Object.keys(groupedMap).sort((a, b) => {
    const groupA = groupedMap[a];
    const groupB = groupedMap[b];
    const dateA = groupA[0]?.createdAt || '';
    const dateB = groupB[0]?.createdAt || '';
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const numA = extractSeriesNumber(a, 'TRF-') || 0;
    const numB = extractSeriesNumber(b, 'TRF-') || 0;
    return numA - numB;
  });

  const oldToNewMap: Record<string, string> = {};
  let changedCount = 0;
  let candidateNum = baseNumber;

  sortedTransferNums.forEach((oldNum) => {
    while (postedTransferNumbers.has(`TRF-${candidateNum}`.toUpperCase())) {
      candidateNum++;
    }
    const targetNum = `TRF-${candidateNum}`;
    if (oldNum !== targetNum) {
      oldToNewMap[oldNum] = targetNum;
      changedCount++;
    }
    candidateNum++;
  });

  if (changedCount === 0) {
    return { updatedCount: 0, oldToNewMap };
  }

  const batch = writeBatch(db);

  // 1. Update DRAFT transfers only
  draftTransfers.forEach(tr => {
    if (tr.id && oldToNewMap[tr.transferNumber]) {
      const newNum = oldToNewMap[tr.transferNumber];
      batch.update(doc(db, 'transfers', tr.id), { transferNumber: newNum });
    }
  });

  await batch.commit();
  return { updatedCount: changedCount, oldToNewMap };
}

/**
 * Auto rearranges Inward GRN series numbers sequentially for DRAFT documents ONLY.
 * CRITICAL (CHANGE 11): Posted Inward GRN documents are IMMUTABLE historical records and must never be renumbered.
 */
export async function rearrangeInwardSeries(
  db: Firestore | null,
  inwards: Inward[],
  movements: StockMovement[],
  baseNumber: number = 1001
): Promise<{ updatedCount: number; oldToNewMap: Record<string, string> }> {
  const draftInwards = inwards.filter(inw => (inw as any).status === 'Draft');

  if (draftInwards.length === 0 || !db) {
    return { updatedCount: 0, oldToNewMap: {} };
  }

  const postedGrnNumbers = new Set(
    inwards
      .filter(inw => (inw as any).status !== 'Draft')
      .map(inw => inw.grnNumber?.trim().toUpperCase())
  );

  const groupedMap: Record<string, Inward[]> = {};
  draftInwards.forEach(inw => {
    if (!groupedMap[inw.grnNumber]) {
      groupedMap[inw.grnNumber] = [];
    }
    groupedMap[inw.grnNumber].push(inw);
  });

  const sortedGrnNums = Object.keys(groupedMap).sort((a, b) => {
    const groupA = groupedMap[a];
    const groupB = groupedMap[b];
    const dateA = groupA[0]?.date || '';
    const dateB = groupB[0]?.date || '';
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const numA = extractSeriesNumber(a, 'GRN-') || 0;
    const numB = extractSeriesNumber(b, 'GRN-') || 0;
    return numA - numB;
  });

  const oldToNewMap: Record<string, string> = {};
  let changedCount = 0;
  let candidateNum = baseNumber;

  sortedGrnNums.forEach((oldNum) => {
    while (postedGrnNumbers.has(`GRN-${candidateNum}`.toUpperCase())) {
      candidateNum++;
    }
    const targetNum = `GRN-${candidateNum}`;
    if (oldNum !== targetNum) {
      oldToNewMap[oldNum] = targetNum;
      changedCount++;
    }
    candidateNum++;
  });

  if (changedCount === 0) {
    return { updatedCount: 0, oldToNewMap };
  }

  const batch = writeBatch(db);

  draftInwards.forEach(inw => {
    if (inw.id && oldToNewMap[inw.grnNumber]) {
      const newNum = oldToNewMap[inw.grnNumber];
      batch.update(doc(db, 'inwards', inw.id), { grnNumber: newNum });
    }
  });

  await batch.commit();
  return { updatedCount: changedCount, oldToNewMap };
}

/**
 * Auto rearranges Manual Stock Adjustment series numbers.
 * CRITICAL (CHANGE 11): Posted stock adjustments in the audit ledger are IMMUTABLE and MUST NEVER be renumbered.
 */
export async function rearrangeAdjustmentSeries(
  db: Firestore | null,
  movements: StockMovement[],
  baseNumber: number = 1001
): Promise<{ updatedCount: number; oldToNewMap: Record<string, string> }> {
  // Adjustments in the ledger are permanently posted transactions and must remain immutable.
  return { updatedCount: 0, oldToNewMap: {} };
}
