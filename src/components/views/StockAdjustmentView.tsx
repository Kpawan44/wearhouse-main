import React, { useState, useMemo } from 'react';
import { Plus, Check, RotateCcw, AlertTriangle, ShieldAlert, Search, History, Undo2, ArrowUpRight, ArrowDownRight, FileText } from 'lucide-react';
import { Product, Warehouse, UserRole, Stock, StockMovement } from '../../types';

interface StockAdjustmentViewProps {
  products: Product[];
  warehouses: Warehouse[];
  stocks: Stock[];
  movements?: StockMovement[];
  onPostAdjustment: (adj: {
    itemCode: string;
    warehouseId: string;
    type: 'Increase' | 'Decrease' | 'Damage' | 'Shortage' | 'Excess';
    qty: number;
    reason: string;
    remarks: string;
  }) => Promise<void>;
  onRevertAdjustment?: (id: string, reason?: string) => Promise<void>;
  currentUserRole: UserRole;
}

export const StockAdjustmentView: React.FC<StockAdjustmentViewProps> = ({
  products,
  warehouses,
  stocks,
  movements = [],
  onPostAdjustment,
  onRevertAdjustment,
  currentUserRole,
}) => {
  const [warehouseId, setWarehouseId] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [type, setType] = useState<'Increase' | 'Decrease' | 'Damage' | 'Shortage' | 'Excess'>('Increase');
  const [qty, setQty] = useState<number | string>(1);
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [revertSearchQuery, setRevertSearchQuery] = useState('');
  const [revertingId, setRevertingId] = useState<string | null>(null);

  const isAuthorized = currentUserRole === 'Super Admin';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!isAuthorized) {
      setFormError('Access Denied. Only Super Admins are authorized to execute manual stock level overrides.');
      return;
    }

    if (!warehouseId || !itemCode) {
      setFormError('Please select both warehouse and product SKU targets.');
      return;
    }

    const numericQty = typeof qty === 'number' ? qty : (parseFloat(qty) || 0);

    if (numericQty <= 0) {
      setFormError('Adjustment quantity must be greater than zero.');
      return;
    }

    if (!reason.trim()) {
      setFormError('A formal adjustment reason is mandatory for auditing compliance.');
      return;
    }

    // BUSINESS RULE CHECK: Prevent Negative Stock!
    const targetStock = stocks.find(s => s.itemCode === itemCode && s.warehouseId === warehouseId);
    const available = targetStock ? targetStock.availableQty : 0;

    if ((type === 'Decrease' || type === 'Damage' || type === 'Shortage') && available < numericQty) {
      setFormError(`Insufficient Stock! Cannot decrease ${numericQty} Pcs of SKU ${itemCode} because the selected warehouse only has ${available} available on-hand.`);
      return;
    }

    try {
      await onPostAdjustment({
        itemCode,
        warehouseId,
        type,
        qty: numericQty,
        reason,
        remarks: remarks || `Manual override adjustment. Type: ${type}`
      });
      setFormSuccess('Stock level adjusted successfully! Transactions posted to stock ledger and security audit trail updated.');
      
      // Reset qty and text fields
      setQty(1);
      setReason('');
      setRemarks('');
    } catch (err) {
      console.error(err);
      setFormError('Failed to record transaction. Ensure cloud database connection is healthy.');
    }
  };

  const handleWarehouseChange = (id: string) => {
    setWarehouseId(id);
    setFormError('');
    setFormSuccess('');
  };

  const handleProductChange = (code: string) => {
    setItemCode(code);
    setFormError('');
    setFormSuccess('');
  };

  // Filter adjustments history
  const manualAdjustmentsHistory = useMemo(() => {
    const adjMovements = movements.filter(m => 
      m.transactionType.includes('Adjustment') || 
      m.referenceNumber.startsWith('ADJ-') ||
      m.referenceNumber.startsWith('REV-ADJ-')
    );

    if (!revertSearchQuery.trim()) return adjMovements;

    const q = revertSearchQuery.toLowerCase();
    return adjMovements.filter(m => 
      m.referenceNumber.toLowerCase().includes(q) ||
      m.itemCode.toLowerCase().includes(q) ||
      m.itemName.toLowerCase().includes(q) ||
      m.warehouseName.toLowerCase().includes(q) ||
      m.remarks.toLowerCase().includes(q) ||
      m.user.toLowerCase().includes(q)
    );
  }, [movements, revertSearchQuery]);

  const handleRevertClick = async (mvt: StockMovement) => {
    if (!onRevertAdjustment) {
      alert("Reversal action function is not available.");
      return;
    }

    if (!isAuthorized) {
      alert("Access Denied. Only Super Admins can revert manual stock adjustments.");
      return;
    }

    const refNo = mvt.referenceNumber;
    const targetId = mvt.id || refNo;

    const confirmReason = window.prompt(
      `REVERT MANUAL STOCK ADJUSTMENT (${refNo})\n\nSKU: ${mvt.itemCode} - ${mvt.itemName}\nWarehouse: ${mvt.warehouseName}\nQty: ${Math.abs(mvt.qty)} Pcs (${mvt.transactionType})\n\nThis will automatically restore the previous stock balance and create an immutable audit record.\n\nPlease enter a reason for this reversal:`,
      `Reversal of manual adjustment ${refNo} requested by ${currentUserRole}`
    );

    if (confirmReason === null) return; // User cancelled

    try {
      setRevertingId(targetId);
      await onRevertAdjustment(targetId, confirmReason.trim() || 'Manual adjustment reverted');
      setFormSuccess(`Successfully reverted adjustment ${refNo}! Restored previous stock balance.`);
    } catch (err: any) {
      console.error("Reversal failed:", err);
      setFormError(`Reversal failed: ${err.message || err}`);
    } finally {
      setRevertingId(null);
    }
  };

  return (
    <div id="stock-adjustment-view" className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-gray-800">Manual Stock Adjustments & Overrides</h2>
          <p className="text-[10px] text-gray-500">Record inventory excess, shortages, damage write-offs, or initial load balances</p>
        </div>

        {!isAuthorized && (
          <span className="text-[10px] bg-red-50 text-red-700 font-bold px-2 py-1.5 rounded-md border border-red-100 flex items-center gap-1.5 shadow-xs">
            <ShieldAlert className="w-3.5 h-3.5 animate-bounce" />
            Super Admin Required
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Adjustment Panel */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-xs p-5 lg:col-span-2">
          <h3 className="font-extrabold text-xs text-gray-900 border-b border-gray-50 pb-3 mb-4 flex items-center gap-1.5">
            🛠️ New Level Override Record
          </h3>

          {formError && (
            <div className="bg-red-50 border border-red-100 text-red-800 text-xs p-3 rounded-lg font-semibold mb-4">
              ⚠️ {formError}
            </div>
          )}

          {formSuccess && (
            <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs p-3 rounded-lg font-bold mb-4 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <p>{formSuccess}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Target Warehouse</label>
                <select
                  required
                  value={warehouseId}
                  onChange={(e) => handleWarehouseChange(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-semibold text-gray-700"
                >
                  <option value="">-- Select Warehouse --</option>
                  {warehouses.map((w, idx) => (
                    <option key={`${w.id || w.code}-${idx}`} value={w.code}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Target SKU / Product</label>
                <select
                  required
                  value={itemCode}
                  onChange={(e) => handleProductChange(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-semibold text-gray-700"
                >
                  <option value="">-- Select Product --</option>
                  {products.map(p => {
                    const currentStock = stocks.find(s => s.itemCode === p.itemCode && s.warehouseId === warehouseId);
                    const av = currentStock ? currentStock.availableQty : 0;
                    return (
                      <option key={p.itemCode} value={p.itemCode}>
                        {p.name} (Current: {av} {p.unit})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Adjustment Action</label>
                <select
                  required
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-semibold text-gray-700"
                >
                  <option value="Increase">Increase (+) Stock (Excess, Loading)</option>
                  <option value="Decrease">Decrease (-) Stock (Shortage, Adjustment)</option>
                  <option value="Damage">Write-off as Damage (Spillage, Broken)</option>
                  <option value="Shortage">Audit Shortage write-down</option>
                  <option value="Excess">Audit Excess write-up</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Quantity change</label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={qty}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '');
                    setQty(val);
                  }}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono font-bold"
                  placeholder="Enter quantity (numbers only)"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Formal Audit Reason</label>
              <input
                type="text"
                required
                placeholder="E.g. Discovered 3 broken boxes during physical cycle count."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Detailed Remarks</label>
              <textarea
                rows={2}
                placeholder="Additional audit notes, supervisor references, or photo reference keys."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end pt-3 border-t border-gray-50">
              <button
                type="submit"
                disabled={!isAuthorized}
                className={`px-4 py-2 text-white font-bold text-xs rounded-lg shadow-xs transition-all cursor-pointer flex items-center gap-1 ${
                  isAuthorized ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-300 cursor-not-allowed'
                }`}
              >
                Post Level Override Action
              </button>
            </div>
          </form>
        </div>

        {/* Security Alert Sidebar */}
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-100 rounded-xl p-5 text-red-900 text-xs leading-relaxed space-y-3 shadow-xs font-semibold">
            <h4 className="font-extrabold text-red-900 flex items-center gap-1.5 uppercase text-[10px] tracking-wider">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              Critical Security Warning
            </h4>
            <p className="text-[11px] leading-normal font-medium">
              Every manual override adjusts live physical stock counts instantly. To maintain integrity compliance, the following gates are locked:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-[10px] text-red-800 font-medium">
              <li>Operator Name, Timestamp and exact location are locked immutably.</li>
              <li>A corresponding record is posted to the write-only Ledger and security audit log.</li>
              <li>Under-stock adjustments that would result in a negative available quantity are automatically blocked.</li>
              <li>Reverting an adjustment automatically restores previous stock balance and logs the reversal in audit trail.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* RECENT ADJUSTMENTS HISTORY & REVERSAL LOG PANEL */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-xs p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-50 pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            <h3 className="font-extrabold text-xs text-gray-900">
              Manual Adjustment History & Reversals Audit
            </h3>
            <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full border border-indigo-100">
              {manualAdjustmentsHistory.length} Entries
            </span>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search ref, SKU, warehouse..."
              value={revertSearchQuery}
              onChange={(e) => setRevertSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase text-[9px] font-extrabold tracking-wider border-b border-gray-100">
                <th className="p-3">Ref No / Date</th>
                <th className="p-3">SKU & Item Name</th>
                <th className="p-3">Warehouse</th>
                <th className="p-3">Action & Qty</th>
                <th className="p-3">Operator / Reason</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {manualAdjustmentsHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400 text-xs font-medium">
                    No manual stock adjustments logged yet.
                  </td>
                </tr>
              ) : (
                manualAdjustmentsHistory.map((mvt) => {
                  const isReversalRecord = !!mvt.reversalOf || mvt.transactionType.includes('Reversal');
                  const isReverted = isReversalRecord || movements.some(other => !!other.reversalOf && (other.reversalOf === mvt.id || other.reversalOf === mvt.referenceNumber));
                  const targetId = mvt.id || mvt.referenceNumber;
                  const isProcessing = revertingId === targetId;

                  return (
                    <tr key={mvt.id || `${mvt.referenceNumber}-${mvt.date}-${mvt.time}`} className={`hover:bg-gray-50/60 transition-colors ${isReverted ? 'bg-gray-50/50 opacity-80' : ''}`}>
                      <td className="p-3 font-mono">
                        <div className="font-bold text-gray-900">{mvt.referenceNumber}</div>
                        <div className="text-[9px] text-gray-400">{mvt.date} {mvt.time}</div>
                      </td>
                      <td className="p-3 font-medium">
                        <div className="font-bold text-gray-800">{mvt.itemName}</div>
                        <div className="text-[9px] font-mono text-gray-500">{mvt.itemCode}</div>
                      </td>
                      <td className="p-3 font-semibold text-gray-700">
                        {mvt.warehouseName}
                      </td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-[10px] ${
                          mvt.transactionType.includes('(Damage)') ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                          mvt.qty > 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                          'bg-rose-50 text-rose-800 border border-rose-200'
                        }`}>
                          {mvt.qty > 0 ? `+${mvt.qty}` : mvt.qty} Pcs
                        </span>
                        <div className="text-[9px] text-gray-500 font-semibold mt-0.5">{mvt.transactionType}</div>
                      </td>
                      <td className="p-3 max-w-xs">
                        <div className="font-bold text-gray-700 text-[10px]">{mvt.user}</div>
                        <div className="text-[10px] text-gray-500 truncate" title={mvt.remarks}>
                          {mvt.remarks}
                        </div>
                      </td>
                      <td className="p-3">
                        {isReverted ? (
                          <span className="text-[9px] bg-amber-100 text-amber-900 font-extrabold px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 w-fit">
                            <Undo2 className="w-2.5 h-2.5" />
                            {isReversalRecord ? 'Reversal Log' : 'Reverted'}
                          </span>
                        ) : (
                          <span className="text-[9px] bg-emerald-50 text-emerald-800 font-bold px-2 py-0.5 rounded-full border border-emerald-100">
                            Active Override
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {!isReverted && !isReversalRecord && onRevertAdjustment && (
                          <button
                            disabled={!isAuthorized || isProcessing}
                            onClick={() => handleRevertClick(mvt)}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1.5 ml-auto cursor-pointer ${
                              isAuthorized && !isProcessing
                                ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-xs'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            }`}
                            title="Revert this manual adjustment, restore previous stock balance, and write audit trail log"
                          >
                            <RotateCcw className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
                            {isProcessing ? 'Reverting...' : 'Revert Adjustment'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
