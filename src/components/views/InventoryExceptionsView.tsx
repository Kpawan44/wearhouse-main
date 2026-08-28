import React, { useState, useMemo } from 'react';
import { 
  AlertTriangle, 
  CheckCircle2, 
  AlertOctagon, 
  RefreshCw, 
  Search, 
  Download, 
  FileText, 
  Clock, 
  ShieldAlert, 
  FileCheck, 
  HelpCircle, 
  X, 
  ExternalLink,
  Layers,
  Database,
  Wrench
} from 'lucide-react';
import { 
  InventoryException, 
  ReconciliationReportSummary, 
  Product, 
  Warehouse, 
  Stock, 
  UserRole,
  ExceptionStatus,
  ExceptionCategory
} from '../../types';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface InventoryExceptionsViewProps {
  exceptions: InventoryException[];
  products: Product[];
  warehouses: Warehouse[];
  stocks?: Stock[];
  currentUserRole: UserRole;
  currentUserName: string;
  onReconcileStock: () => Promise<any>;
  onResolveException: (exceptionId: string, resolutionNote: string, resolutionTransactionId?: string) => Promise<void>;
  onMarkExceptionUnderReview: (exceptionId: string, notes?: string) => Promise<void>;
  lastReport?: ReconciliationReportSummary | null;
  onNavigateToAdjustment?: () => void;
  onAutoCorrectExceptions?: () => Promise<void>;
}

export const InventoryExceptionsView: React.FC<InventoryExceptionsViewProps> = ({
  exceptions = [],
  products = [],
  warehouses = [],
  stocks = [],
  currentUserRole,
  currentUserName,
  onReconcileStock,
  onResolveException,
  onMarkExceptionUnderReview,
  lastReport,
  onNavigateToAdjustment,
  onAutoCorrectExceptions
}) => {
  const [statusFilter, setStatusFilter] = useState<'ALL' | ExceptionStatus>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | ExceptionCategory | 'HEALTHY'>('ALL');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isReconciling, setIsReconciling] = useState<boolean>(false);
  const [isAutoCorrecting, setIsAutoCorrecting] = useState<boolean>(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);

  // Modal States
  const [selectedException, setSelectedException] = useState<InventoryException | null>(null);
  const [isResolveModalOpen, setIsResolveModalOpen] = useState<boolean>(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState<boolean>(false);
  const [resolutionNote, setResolutionNote] = useState<string>('');
  const [resolutionTransactionId, setResolutionTransactionId] = useState<string>('');
  const [reviewNote, setReviewNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Metric Computations
  const openExceptions = useMemo(() => exceptions.filter(e => e.status === 'OPEN'), [exceptions]);
  const underReviewExceptions = useMemo(() => exceptions.filter(e => e.status === 'UNDER_REVIEW'), [exceptions]);
  const resolvedExceptions = useMemo(() => exceptions.filter(e => e.status === 'RESOLVED'), [exceptions]);

  const negativeStockExceptions = useMemo(() => 
    exceptions.filter(e => e.category === 'NEGATIVE_STOCK' && e.status !== 'RESOLVED'), 
    [exceptions]
  );
  
  const discrepancyExceptions = useMemo(() => 
    exceptions.filter(e => e.category === 'DISCREPANCY' && e.status !== 'RESOLVED'), 
    [exceptions]
  );

  const orphanExceptions = useMemo(() => 
    exceptions.filter(e => e.category === 'ORPHAN_RECORD' && e.status !== 'RESOLVED'), 
    [exceptions]
  );

  const healthyItemsCount = lastReport?.healthyCount ?? Math.max(0, (products.length * warehouses.length) - (negativeStockExceptions.length + discrepancyExceptions.length));

  // Trigger Reconciliation Audit
  const handleRunReconciliation = async () => {
    setIsReconciling(true);
    setReconcileMessage(null);
    try {
      const res = await onReconcileStock();
      const disc = res?.discrepancyCount ?? 0;
      const neg = res?.negativeStockCount ?? 0;
      const orph = res?.orphanCount ?? 0;
      const hlth = res?.healthyCount ?? 0;

      if (disc === 0 && neg === 0 && orph === 0) {
        setReconcileMessage(`Audit Completed: All ${hlth} stock balance records are 100% healthy with zero discrepancies.`);
      } else {
        setReconcileMessage(`Audit Completed: Detected ${disc} discrepancies, ${neg} negative balances, and ${orph} orphan records. Exceptions logged.`);
      }
    } catch (err: any) {
      setReconcileMessage(`Reconciliation audit failed: ${err.message || err}`);
    } finally {
      setIsReconciling(false);
      setTimeout(() => setReconcileMessage(null), 8000);
    }
  };

  // Filtered Exceptions List
  const filteredExceptions = useMemo(() => {
    return exceptions.filter(exc => {
      // Status Filter
      if (statusFilter !== 'ALL' && exc.status !== statusFilter) return false;

      // Category Filter
      if (categoryFilter !== 'ALL' && categoryFilter !== 'HEALTHY' && exc.category !== categoryFilter) return false;

      // Warehouse Filter
      if (warehouseFilter !== 'ALL' && exc.warehouseId !== warehouseFilter) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchItem = exc.itemCode?.toLowerCase().includes(q) || exc.itemName?.toLowerCase().includes(q);
        const matchWh = exc.warehouseName?.toLowerCase().includes(q) || exc.warehouseId?.toLowerCase().includes(q);
        const matchReason = exc.reason?.toLowerCase().includes(q);
        const matchTx = exc.relatedTransactionIds?.some(tx => tx.toLowerCase().includes(q));
        const matchId = exc.id?.toLowerCase().includes(q);
        if (!matchItem && !matchWh && !matchReason && !matchTx && !matchId) return false;
      }

      return true;
    });
  }, [exceptions, statusFilter, categoryFilter, warehouseFilter, searchQuery]);

  // Open Resolve Modal
  const handleOpenResolve = (exc: InventoryException) => {
    setSelectedException(exc);
    setResolutionNote('');
    setResolutionTransactionId('');
    setIsResolveModalOpen(true);
  };

  // Submit Resolution
  const handleConfirmResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedException || !resolutionNote.trim()) {
      alert("Please provide a resolution note detailing the root-cause analysis and corrective action taken.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onResolveException(
        selectedException.id!,
        resolutionNote.trim(),
        resolutionTransactionId.trim() || undefined
      );
      setIsResolveModalOpen(false);
      setSelectedException(null);
    } catch (err: any) {
      alert(`Failed to resolve exception: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Review Modal
  const handleOpenReview = (exc: InventoryException) => {
    setSelectedException(exc);
    setReviewNote(exc.notes || '');
    setIsReviewModalOpen(true);
  };

  // Submit Review Status
  const handleConfirmReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedException) return;

    setIsSubmitting(true);
    try {
      await onMarkExceptionUnderReview(
        selectedException.id!,
        reviewNote.trim() || undefined
      );
      setIsReviewModalOpen(false);
      setSelectedException(null);
    } catch (err: any) {
      alert(`Failed to update status: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Auto Correct all exceptions via Super Admin atomic adjustment
  const handleAutoCorrect = async () => {
    if (!onAutoCorrectExceptions) return;
    if (!window.confirm("Are you sure you want to auto-reconcile and align all active stock discrepancies with official audit adjustment entries?")) return;
    setIsAutoCorrecting(true);
    try {
      await onAutoCorrectExceptions();
    } catch (err: any) {
      alert(`Auto-reconciliation error: ${err.message || err}`);
    } finally {
      setIsAutoCorrecting(false);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      'Exception ID',
      'Status',
      'Category',
      'Warehouse ID',
      'Warehouse Name',
      'Item Code',
      'Item Name',
      'Expected Qty',
      'Current Stored Qty',
      'Difference',
      'Reason',
      'Detected At',
      'Detected By',
      'Resolved By',
      'Resolved At',
      'Resolution Note',
      'Resolution Tx ID'
    ];

    const rows = filteredExceptions.map(e => [
      e.id || '',
      e.status,
      e.category,
      e.warehouseId,
      e.warehouseName || '',
      e.itemCode,
      e.itemName || '',
      e.expectedQty,
      e.currentQty,
      e.difference,
      e.reason,
      e.detectedAt,
      e.detectedBy,
      e.resolvedBy || '',
      e.resolvedAt || '',
      e.resolutionNote || '',
      e.resolutionTransactionId || ''
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Inventory_Exceptions_Audit_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export PDF
  const handleExportPDF = () => {
    const doc = new jsPDF('landscape');
    doc.setFontSize(16);
    doc.setTextColor(30, 41, 59);
    doc.text('STOCKFLOW APEX — INVENTORY RECONCILIATION & EXCEPTIONS AUDIT', 14, 15);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated on: ${new Date().toLocaleString()} | Auditor: ${currentUserName}`, 14, 22);
    doc.text(`Scope: ${filteredExceptions.length} exception record(s) | Open: ${openExceptions.length} | Under Review: ${underReviewExceptions.length} | Resolved: ${resolvedExceptions.length}`, 14, 27);

    const headers = [['ID', 'Status', 'Category', 'Warehouse', 'SKU', 'Expected', 'Current', 'Diff', 'Detected At', 'Resolution Details']];
    const data = filteredExceptions.map(e => [
      e.id?.slice(0, 12) || '',
      e.status,
      e.category,
      e.warehouseId,
      e.itemCode,
      e.expectedQty.toString(),
      e.currentQty.toString(),
      e.difference.toString(),
      e.detectedAt.slice(0, 10),
      e.status === 'RESOLVED' ? `By: ${e.resolvedBy || '-'} | Note: ${e.resolutionNote || '-'}` : e.reason.slice(0, 40)
    ]);

    autoTable(doc, {
      head: headers,
      body: data,
      startY: 32,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] }
    });

    doc.save(`Inventory_Exceptions_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Info & Actions */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <ShieldAlert className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Inventory Reconciliation & Exception Registry
              </h2>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-3xl leading-relaxed">
              Non-destructive discrepancy detection and forensic ledger audit. Expected stock is calculated from immutable transaction ledger history and compared against stored inventory balances. Discrepancies are logged as formal exceptions requiring authorized investigation and explicit resolution.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {currentUserRole === 'Super Admin' && onAutoCorrectExceptions && (
              <button
                onClick={handleAutoCorrect}
                disabled={isAutoCorrecting || isReconciling}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-3.5 py-2 rounded-lg text-xs flex items-center gap-2 cursor-pointer transition-all shadow-xs"
                title="Automatically post adjustment documents to align ledger and resolve discrepancies"
              >
                <Wrench className={`w-4 h-4 ${isAutoCorrecting ? 'animate-spin' : ''}`} />
                {isAutoCorrecting ? 'Aligning Ledger...' : 'Auto-Reconcile Discrepancies'}
              </button>
            )}

            <button
              onClick={handleRunReconciliation}
              disabled={isReconciling || isAutoCorrecting}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold px-3.5 py-2 rounded-lg text-xs flex items-center gap-2 cursor-pointer transition-all shadow-xs"
              title="Run ledger reconciliation audit"
            >
              <RefreshCw className={`w-4 h-4 ${isReconciling ? 'animate-spin' : ''}`} />
              {isReconciling ? 'Auditing Ledger...' : 'Run Reconciliation Audit'}
            </button>

            <button
              onClick={handleExportCSV}
              className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
              title="Export filtered exceptions to CSV"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>

            <button
              onClick={handleExportPDF}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
              title="Export audit report to PDF"
            >
              <FileText className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        </div>

        {reconcileMessage && (
          <div className="mt-4 p-3 rounded-lg text-xs font-semibold flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 animate-fade-in">
            <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>{reconcileMessage}</span>
          </div>
        )}
      </div>

      {/* Bento Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {/* Healthy Pairs */}
        <div 
          onClick={() => { setStatusFilter('ALL'); setCategoryFilter('HEALTHY'); }}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            categoryFilter === 'HEALTHY' 
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 ring-2 ring-emerald-500/20' 
              : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:border-emerald-300'
          }`}
        >
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Healthy Pairs</span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="text-xl font-bold text-gray-900 dark:text-white">{healthyItemsCount}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Expected = Stored</div>
        </div>

        {/* Discrepancies */}
        <div 
          onClick={() => { setStatusFilter('ALL'); setCategoryFilter('DISCREPANCY'); }}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            categoryFilter === 'DISCREPANCY' 
              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 ring-2 ring-amber-500/20' 
              : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Discrepancies</span>
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="text-xl font-bold text-gray-900 dark:text-white">{discrepancyExceptions.length}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Expected ≠ Stored</div>
        </div>

        {/* Negative Stock */}
        <div 
          onClick={() => { setStatusFilter('ALL'); setCategoryFilter('NEGATIVE_STOCK'); }}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            categoryFilter === 'NEGATIVE_STOCK' 
              ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-700 ring-2 ring-rose-500/20' 
              : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:border-rose-300'
          }`}
        >
          <div className="flex items-center justify-between text-rose-600 dark:text-rose-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Negative Stock</span>
            <AlertOctagon className="w-4 h-4" />
          </div>
          <div className="text-xl font-bold text-gray-900 dark:text-white">{negativeStockExceptions.length}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Expected Qty &lt; 0</div>
        </div>

        {/* Orphan Records */}
        <div 
          onClick={() => { setStatusFilter('ALL'); setCategoryFilter('ORPHAN_RECORD'); }}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            categoryFilter === 'ORPHAN_RECORD' 
              ? 'bg-purple-50 dark:bg-purple-950/40 border-purple-300 dark:border-purple-700 ring-2 ring-purple-500/20' 
              : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:border-purple-300'
          }`}
        >
          <div className="flex items-center justify-between text-purple-600 dark:text-purple-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Orphan Records</span>
            <Database className="w-4 h-4" />
          </div>
          <div className="text-xl font-bold text-gray-900 dark:text-white">{orphanExceptions.length}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Evidence Preserved</div>
        </div>

        {/* Open Exceptions */}
        <div 
          onClick={() => { setStatusFilter('OPEN'); setCategoryFilter('ALL'); }}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            statusFilter === 'OPEN' 
              ? 'bg-orange-50 dark:bg-orange-950/40 border-orange-300 dark:border-orange-700 ring-2 ring-orange-500/20' 
              : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:border-orange-300'
          }`}
        >
          <div className="flex items-center justify-between text-orange-600 dark:text-orange-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Open</span>
            <Clock className="w-4 h-4" />
          </div>
          <div className="text-xl font-bold text-gray-900 dark:text-white">{openExceptions.length}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Awaiting Action</div>
        </div>

        {/* Resolved */}
        <div 
          onClick={() => { setStatusFilter('RESOLVED'); setCategoryFilter('ALL'); }}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
            statusFilter === 'RESOLVED' 
              ? 'bg-teal-50 dark:bg-teal-950/40 border-teal-300 dark:border-teal-700 ring-2 ring-teal-500/20' 
              : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:border-teal-300'
          }`}
        >
          <div className="flex items-center justify-between text-teal-600 dark:text-teal-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Resolved</span>
            <FileCheck className="w-4 h-4" />
          </div>
          <div className="text-xl font-bold text-gray-900 dark:text-white">{resolvedExceptions.length}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Explicitly Closed</div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 mr-1">Status:</span>
            {(['ALL', 'OPEN', 'UNDER_REVIEW', 'RESOLVED'] as const).map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  statusFilter === st
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                }`}
              >
                {st === 'ALL' ? 'All Statuses' : st.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* Warehouse and Search */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <select
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              className="bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800 dark:text-gray-200"
            >
              <option value="ALL">All Warehouses</option>
              {warehouses.map(w => (
                <option key={w.code || w.id} value={w.code || w.id}>
                  {w.name} ({w.code || w.id})
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search SKU, warehouse, reason..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-56"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Exceptions Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
              Exception Ledger & Integrity Audit Log ({filteredExceptions.length})
            </h3>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400">
            Showing discrepancies, negative stock, and orphan records
          </div>
        </div>

        {filteredExceptions.length === 0 ? (
          <div className="p-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3 opacity-90" />
            <h4 className="text-base font-bold text-gray-900 dark:text-white mb-1">
              No Exceptions Found For Current Filter
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              All inventory records in this view are healthy and consistent with ledger movements, or no matching records match your query.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50/75 dark:bg-slate-700/50 text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider border-b border-gray-200 dark:border-slate-700">
                <tr>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Warehouse</th>
                  <th className="py-3 px-4">Product / Record</th>
                  <th className="py-3 px-4 text-right">Expected Stock</th>
                  <th className="py-3 px-4 text-right">Stored Stock</th>
                  <th className="py-3 px-4 text-right">Difference</th>
                  <th className="py-3 px-4">Detected</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {filteredExceptions.map(exc => {
                  const isNegative = exc.category === 'NEGATIVE_STOCK' || exc.expectedQty < 0;
                  const isOrphan = exc.category === 'ORPHAN_RECORD';
                  const isDiscrepancy = exc.category === 'DISCREPANCY';

                  return (
                    <tr key={exc.id || `${exc.warehouseId}-${exc.itemCode}`} className="hover:bg-gray-50/50 dark:hover:bg-slate-750 transition-colors">
                      {/* Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                          exc.status === 'RESOLVED'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : exc.status === 'UNDER_REVIEW'
                            ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        }`}>
                          {exc.status === 'RESOLVED' && <CheckCircle2 className="w-3 h-3" />}
                          {exc.status === 'UNDER_REVIEW' && <Clock className="w-3 h-3" />}
                          {exc.status === 'OPEN' && <AlertCircle className="w-3 h-3" />}
                          {exc.status.replace('_', ' ')}
                        </span>
                      </td>

                      {/* Category */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          isNegative
                            ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                            : isOrphan
                            ? 'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800'
                            : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                        }`}>
                          {exc.category.replace('_', ' ')}
                        </span>
                      </td>

                      {/* Warehouse */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {exc.warehouseName || exc.warehouseId}
                        </div>
                        <div className="text-[10px] text-gray-400 font-mono">
                          {exc.warehouseId}
                        </div>
                      </td>

                      {/* Product */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-gray-900 dark:text-white">
                          {exc.itemCode}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-xs" title={exc.itemName || exc.reason}>
                          {exc.itemName || exc.reason}
                        </div>
                      </td>

                      {/* Expected Qty */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <span className={`font-mono font-bold ${
                          exc.expectedQty < 0 
                            ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-1.5 py-0.5 rounded' 
                            : 'text-gray-800 dark:text-gray-200'
                        }`}>
                          {exc.expectedQty.toLocaleString()}
                        </span>
                      </td>

                      {/* Current Stored Qty */}
                      <td className="py-3 px-4 text-right whitespace-nowrap font-mono text-gray-700 dark:text-gray-300">
                        {exc.currentQty.toLocaleString()}
                      </td>

                      {/* Difference */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <span className={`font-mono font-bold px-1.5 py-0.5 rounded ${
                          exc.difference === 0
                            ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : exc.difference < 0
                            ? 'text-rose-700 bg-rose-50 dark:bg-rose-950/50 dark:text-rose-300'
                            : 'text-amber-700 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-300'
                        }`}>
                          {exc.difference > 0 ? `+${exc.difference.toLocaleString()}` : exc.difference.toLocaleString()}
                        </span>
                      </td>

                      {/* Detected Date */}
                      <td className="py-3 px-4 whitespace-nowrap text-[11px] text-gray-500 dark:text-gray-400">
                        <div>{exc.detectedAt?.slice(0, 10)}</div>
                        <div className="text-[10px] text-gray-400">By: {exc.detectedBy}</div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => { setSelectedException(exc); setIsDetailsModalOpen(true); }}
                            className="p-1.5 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                            title="View full audit details & transaction logs"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>

                          {exc.status === 'OPEN' && (
                            <button
                              onClick={() => handleOpenReview(exc)}
                              className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 rounded text-[11px] font-bold transition-colors cursor-pointer"
                              title="Mark as Under Review for investigation"
                            >
                              Investigate
                            </button>
                          )}

                          {exc.status !== 'RESOLVED' && (
                            <button
                              onClick={() => handleOpenResolve(exc)}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold transition-colors cursor-pointer shadow-2xs"
                              title="Explicitly resolve exception with audit note"
                            >
                              Resolve
                            </button>
                          )}

                          {exc.status === 'RESOLVED' && (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded">
                              Resolved
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Explicit Resolution Modal */}
      {isResolveModalOpen && selectedException && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Explicit Exception Resolution
                </h3>
              </div>
              <button
                onClick={() => setIsResolveModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Exception Overview */}
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3.5 text-xs space-y-1.5 border border-slate-200 dark:border-slate-600">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Exception ID:</span>
                <span className="font-mono font-bold text-gray-900 dark:text-white">{selectedException.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Warehouse:</span>
                <span className="font-bold text-gray-900 dark:text-white">{selectedException.warehouseName} ({selectedException.warehouseId})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">SKU / Item:</span>
                <span className="font-bold text-gray-900 dark:text-white">{selectedException.itemCode} - {selectedException.itemName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Expected vs Current:</span>
                <span className="font-mono font-bold text-gray-900 dark:text-white">
                  Exp: {selectedException.expectedQty} | Cur: {selectedException.currentQty} (Diff: {selectedException.difference})
                </span>
              </div>
              <div className="text-[11px] text-gray-600 dark:text-gray-300 pt-1 border-t border-slate-200 dark:border-slate-600">
                <strong className="text-slate-700 dark:text-slate-200">Reason:</strong> {selectedException.reason}
              </div>
            </div>

            <form onSubmit={handleConfirmResolve} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Resolution Root-Cause & Action Note <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Describe root cause investigation findings and authorized corrective action taken (e.g., Stock adjustment posted, physical count matched, supplier shortage confirmed)..."
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  className="w-full text-xs bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg p-2.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-800 dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Corrective Transaction Reference (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. ADJ-17283948, GRN-0023, MVT-9938"
                  value={resolutionTransactionId}
                  onChange={(e) => setResolutionTransactionId(e.target.value)}
                  className="w-full text-xs bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-800 dark:text-gray-200"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsResolveModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !resolutionNote.trim()}
                  className="px-4 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Resolving...' : 'Confirm Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Under Review Modal */}
      {isReviewModalOpen && selectedException && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Mark Under Active Review
                </h3>
              </div>
              <button
                onClick={() => setIsReviewModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-300">
              Set status to <strong>UNDER_REVIEW</strong> while warehouse supervisors perform physical bin counting or document verification.
            </p>

            <form onSubmit={handleConfirmReview} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Investigation Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Physical recount assigned to shift supervisor. Checking dispatch bay 3 for missing cartons..."
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  className="w-full text-xs bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg p-2.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-800 dark:text-gray-200"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReviewModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Set Under Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Details & Forensics Modal */}
      {isDetailsModalOpen && selectedException && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 max-w-lg w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Exception Forensic Details
                </h3>
              </div>
              <button
                onClick={() => setIsDetailsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg">
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">Record Status</span>
                  <span className="font-bold text-gray-900 dark:text-white">{selectedException.status}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">Category</span>
                  <span className="font-bold text-gray-900 dark:text-white">{selectedException.category}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">Detected On</span>
                  <span className="font-mono text-gray-800 dark:text-gray-200">{selectedException.detectedAt}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">Detected By</span>
                  <span className="text-gray-800 dark:text-gray-200">{selectedException.detectedBy}</span>
                </div>
              </div>

              <div>
                <span className="text-gray-400 block text-[10px] uppercase font-bold mb-1">Reason & Diagnostic</span>
                <p className="bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 p-2.5 rounded-lg border border-rose-200 dark:border-rose-800">
                  {selectedException.reason}
                </p>
              </div>

              {selectedException.orphanDetails && (
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase font-bold mb-1">Orphan Record Metadata</span>
                  <div className="bg-purple-50 dark:bg-purple-950/30 text-purple-800 dark:text-purple-200 p-2.5 rounded-lg border border-purple-200 dark:border-purple-800 space-y-1">
                    <div><strong>Record ID:</strong> {selectedException.orphanDetails.recordId}</div>
                    <div><strong>Collection:</strong> {selectedException.orphanDetails.collection}</div>
                    <div><strong>Referenced Entity:</strong> {selectedException.orphanDetails.referencedEntity || '-'}</div>
                    <div><strong>Possible Cause:</strong> {selectedException.orphanDetails.possibleCause || '-'}</div>
                  </div>
                </div>
              )}

              {selectedException.relatedTransactionIds && selectedException.relatedTransactionIds.length > 0 && (
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase font-bold mb-1">Related Transaction IDs</span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedException.relatedTransactionIds.map(tx => (
                      <span key={tx} className="font-mono text-[11px] bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
                        {tx}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedException.status === 'RESOLVED' && (
                <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 space-y-1">
                  <div className="font-bold text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Resolution Log
                  </div>
                  <div><strong>Resolved By:</strong> {selectedException.resolvedBy}</div>
                  <div><strong>Resolved At:</strong> {selectedException.resolvedAt}</div>
                  <div><strong>Note:</strong> {selectedException.resolutionNote}</div>
                  {selectedException.resolutionTransactionId && (
                    <div><strong>Transaction ID:</strong> {selectedException.resolutionTransactionId}</div>
                  )}
                </div>
              )}

              {onNavigateToAdjustment && selectedException.status !== 'RESOLVED' && (
                <div className="pt-2">
                  <button
                    onClick={() => {
                      setIsDetailsModalOpen(false);
                      onNavigateToAdjustment();
                    }}
                    className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    Post Corrective Stock Adjustment Transaction
                  </button>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsDetailsModalOpen(false)}
                className="px-4 py-1.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function AlertCircle(props: { className?: string }) {
  return (
    <svg 
      className={props.className} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
