import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Check, Play, Send, CheckSquare, X, ArrowLeftRight, HelpCircle, FileText, ArrowRight, ShieldCheck, Printer, Trash2, Clock, CheckCircle2, ChevronDown, ChevronUp, Edit3, RotateCcw, AlertTriangle, Save } from 'lucide-react';
import { Transfer, Product, Warehouse, UserRole, Stock, getLiveAvailableQty } from '../../types';
import { Swipeable } from '../Swipeable';
import { generateNextUniqueSeries, isSeriesUnique } from '../../utils/seriesUtils';

interface TransferViewProps {
  transfers: Transfer[];
  products: Product[];
  warehouses: Warehouse[];
  stocks: Stock[];
  onAddTransfer: (tr: Omit<Transfer, 'id'>) => Promise<void>;
  onUpdateTransferStatus: (
    id: string,
    nextStatus: Transfer['status'],
    remarks?: string,
    receiptDetails?: {
      items?: { itemCode: string; itemName: string; qty: number; receivedQty: number; shortQty: number; shortReason?: string }[];
      receivingRemarks?: string;
    }
  ) => Promise<void>;
  onEditTransfer?: (id: string, updatedTransfer: Partial<Transfer>) => Promise<void>;
  onUndoTransfer?: (id: string, targetStatus?: 'Pending Approval' | 'Draft') => Promise<void>;
  onDeleteTransfer: (id: string) => Promise<void>;
  onRearrangeSeries?: () => Promise<any>;
  currentUserRole: UserRole;
  currentWarehouseId: string;
}

export const TransferView: React.FC<TransferViewProps> = ({
  transfers,
  products,
  warehouses,
  stocks,
  onAddTransfer,
  onUpdateTransferStatus,
  onEditTransfer,
  onUndoTransfer,
  onDeleteTransfer,
  onRearrangeSeries,
  currentUserRole,
  currentWarehouseId,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  
  // Create Form State
  const [sourceWhId, setSourceWhId] = useState('');
  const [destWhId, setDestWhId] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [qty, setQty] = useState<number | string>(5);
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState('');
  const [customTransferNumber, setCustomTransferNumber] = useState('');
  
  // Multi-item transfer entry and Invoice-wise entry details states
  const [formItems, setFormItems] = useState<any[]>([]);
  const [customInvoiceNo, setCustomInvoiceNo] = useState('');
  const [customInvoiceDate, setCustomInvoiceDate] = useState(new Date().toISOString().slice(0, 10));

  // Transfer Slips Printing Simulation State
  const [printingTransfer, setPrintingTransfer] = useState<Transfer | null>(null);

  // --- SHORTAGE RECEIVE MODAL STATE ---
  const [receiveModalTransfer, setReceiveModalTransfer] = useState<Transfer | null>(null);
  const [receiptItemsState, setReceiptItemsState] = useState<{
    itemCode: string;
    itemName: string;
    dispatchedQty: number;
    receivedQty: number;
    shortQty: number;
    shortReason: string;
  }[]>([]);
  const [receivingRemarksInput, setReceivingRemarksInput] = useState('');

  // --- ADMIN EDIT ENTRY MODAL STATE ---
  const [editingTransfer, setEditingTransfer] = useState<Transfer | null>(null);
  const [editSourceWhId, setEditSourceWhId] = useState('');
  const [editDestWhId, setEditDestWhId] = useState('');
  const [editInvoiceNo, setEditInvoiceNo] = useState('');
  const [editInvoiceDate, setEditInvoiceDate] = useState('');
  const [editItems, setEditItems] = useState<any[]>([]);
  const [editRemarks, setEditRemarks] = useState('');
  const [editError, setEditError] = useState('');

  // --- ADMIN UNDO ENTRY MODAL STATE ---
  const [undoModalTransfer, setUndoModalTransfer] = useState<Transfer | null>(null);
  const [undoResetTarget, setUndoResetTarget] = useState<'Pending Approval' | 'Draft'>('Pending Approval');

  // Transfer card expand/collapse toggle state (hidden by default)
  const [expandedTransferIds, setExpandedTransferIds] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedTransferIds(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const isSuperAdmin = currentUserRole === 'Super Admin';
  const isAdmin = currentUserRole === 'Super Admin' || currentUserRole === 'Admin' || currentUserRole === 'Warehouse Admin';
  const shouldRestrictWarehouse = !isSuperAdmin && !!currentWarehouseId;

  const isStoreOperator = currentUserRole === 'Store Operator' || currentUserRole === 'Super Admin' || currentUserRole === 'Admin';
  const isManager = currentUserRole === 'Super Admin' || currentUserRole === 'Admin';
  const isViewer = currentUserRole === 'Viewer';

  const primaryWh = warehouses.find(w => w.isPrimary);
  const activeWh = warehouses.find(w => w.code === currentWarehouseId);
  const isLoggedIntoSecondary = activeWh ? !activeWh.isPrimary : false;

  const openCreateForm = () => {
    setFormError('');
    setFormItems([]);
    setCustomInvoiceNo('');
    setCustomInvoiceDate(new Date().toISOString().slice(0, 10));

    // Auto-generate next guaranteed unique series number
    const existingSeries = transfers.map(t => t.transferNumber);
    const nextUniqueNum = generateNextUniqueSeries('TRF', existingSeries, 1001);
    setCustomTransferNumber(nextUniqueNum);
    
    // Set appropriate source warehouse and prefill/lock
    if (isLoggedIntoSecondary) {
      setSourceWhId(currentWarehouseId);
      const remainingWh = warehouses.find(w => w.code !== currentWarehouseId);
      setDestWhId(remainingWh ? remainingWh.code : '');
    } else if (primaryWh) {
      setSourceWhId(primaryWh.code);
      const remainingWh = warehouses.find(w => w.code !== primaryWh.code);
      setDestWhId(remainingWh ? remainingWh.code : '');
    } else if (currentUserRole !== 'Super Admin' && currentWarehouseId) {
      setSourceWhId(currentWarehouseId);
      const remainingWh = warehouses.find(w => w.code !== currentWarehouseId);
      setDestWhId(remainingWh ? remainingWh.code : '');
    } else {
      setSourceWhId(warehouses[0]?.code || '');
      setDestWhId(warehouses[1]?.code || '');
    }
    setItemCode(products[0]?.itemCode || '');
    setQty(5);
    setRemarks(isLoggedIntoSecondary ? 'Stock return/transfer from secondary warehouse.' : 'Primary Warehouse direct inventory supply via invoice.');
    setIsFormOpen(true);
  };

  const handleAddItemToList = () => {
    setFormError('');
    if (!itemCode) {
      setFormError('Please select a product SKU first.');
      return;
    }
    const numQty = typeof qty === 'number' ? qty : (parseFloat(qty) || 0);
    if (numQty <= 0) {
      setFormError('Quantity must be greater than zero.');
      return;
    }

    const sourceWh = warehouses.find(w => w.code === sourceWhId);
    const product = products.find(p => p.itemCode === itemCode);

    if (!sourceWh || !product) {
      setFormError('Ensure Source Warehouse and Product are selected.');
      return;
    }

    // Check if duplicate SKU is added
    if (formItems.some(i => i.itemCode === itemCode)) {
      setFormError(`Product [${itemCode}] is already added. Remove it first to adjust quantity.`);
      return;
    }

    // BUSINESS RULE CHECK: Prevent Negative Stock (bypassed if source warehouse is primary)!
    const sourceStock = stocks.find(s => s.itemCode === itemCode && s.warehouseId === sourceWhId);
    const available = sourceStock ? getLiveAvailableQty(sourceStock, warehouses) : 0;

    if (!sourceWh.isPrimary && available < numQty) {
      setFormError(`Insufficient Stock! Only ${available} ${product.unit || 'Pcs'}(s) available in ${sourceWh.name} for SKU: ${itemCode}. Cannot add ${numQty} Pcs.`);
      return;
    }

    const rate = product.purchaseRate || 100;
    const taxable = rate * numQty;
    const gstAmount = taxable * ((product.gst || 18) / 100);
    const total = taxable + gstAmount;

    const newItem = {
      itemCode: product.itemCode,
      itemName: product.name,
      qty: numQty,
      rate,
      taxableValue: taxable,
      gstPercent: product.gst || 18,
      gstAmount,
      totalValue: total
    };

    setFormItems([...formItems, newItem]);
    setQty(5); // reset qty input
  };

  const handleRemoveItemFromList = (code: string) => {
    setFormItems(formItems.filter(i => i.itemCode !== code));
  };

  // Compute form aggregates
  const formSubtotal = formItems.reduce((acc, curr) => acc + (curr.taxableValue || 0), 0);
  const formGstTotal = formItems.reduce((acc, curr) => acc + (curr.gstAmount || 0), 0);
  const formGrandTotal = formItems.reduce((acc, curr) => acc + (curr.totalValue || 0), 0);

  const handleCreateTransfer = async (e: React.FormEvent, isDraft: boolean) => {
    e.preventDefault();
    setFormError('');

    if (sourceWhId === destWhId) {
      setFormError('Source and Destination Warehouses must be different.');
      return;
    }

    if (formItems.length === 0) {
      setFormError('Please add at least one item to the transfer list.');
      return;
    }

    const sourceWh = warehouses.find(w => w.code === sourceWhId);
    const destWh = warehouses.find(w => w.code === destWhId);

    if (!sourceWh || !destWh) {
      setFormError('Ensure warehouses are fully filled.');
      return;
    }

    // BUSINESS RULE CHECK: Must be supplied from primary warehouse if a primary exists (Bypassed if source is a secondary warehouse)
    const sourceWhObj = warehouses.find(w => w.code === sourceWhId);
    const isSourceSecondary = sourceWhObj ? !sourceWhObj.isPrimary : false;

    if (!isSourceSecondary && primaryWh && sourceWhId !== primaryWh.code) {
      setFormError(`Business Rules Mandate: Goods must be supplied from the Primary Warehouse (${primaryWh.name}) to secondary warehouses.`);
      return;
    }

    // Verify stock one last time for all added items (bypassed if source warehouse is primary)
    if (!sourceWh.isPrimary) {
      for (const item of formItems) {
        const sourceStock = stocks.find(s => s.itemCode === item.itemCode && s.warehouseId === sourceWhId);
        const available = sourceStock ? getLiveAvailableQty(sourceStock, warehouses) : 0;
        if (available < item.qty) {
          setFormError(`Insufficient stock for product ${item.itemName} (${item.itemCode})! Available: ${available}, Required: ${item.qty}`);
          return;
        }
      }
    }

    const finalTransferNum = customTransferNumber.trim() || generateNextUniqueSeries('TRF', transfers.map(t => t.transferNumber), 1001);

    if (!isSeriesUnique(finalTransferNum, transfers.map(t => t.transferNumber))) {
      setFormError(`Series Ref Number "${finalTransferNum}" already exists! Transfer reference numbers must be strictly unique.`);
      return;
    }

    // GENERATE SUPPLY INVOICE DETAILS
    const isSourcePrimary = sourceWh.isPrimary;
    const invDetails: Partial<Transfer> = {};
    if (isSourcePrimary) {
      invDetails.invoiceNumber = customInvoiceNo || `INV-${sourceWh.code}-${Date.now().toString().slice(-5)}`;
      invDetails.invoiceDate = customInvoiceDate || new Date().toISOString().slice(0, 10);
      invDetails.taxableValue = formSubtotal;
      invDetails.gstAmount = formGstTotal;
      invDetails.invoiceTotal = formGrandTotal;
    }

    await onAddTransfer({
      transferNumber: finalTransferNum,
      sourceWarehouseId: sourceWhId,
      sourceWarehouseName: sourceWh.name,
      destWarehouseId: destWhId,
      destWarehouseName: destWh.name,
      itemCode: formItems[0].itemCode,
      itemName: formItems[0].itemName + (formItems.length > 1 ? ` (+${formItems.length - 1} other items)` : ''),
      qty: formItems.reduce((sum, item) => sum + item.qty, 0),
      items: formItems,
      status: isDraft ? 'Draft' : 'Pending Approval',
      createdBy: `${currentUserRole} Operator`,
      createdAt: new Date().toISOString(),
      remarks,
      ...invDetails,
    });

    setIsFormOpen(false);
  };

  // Helpers for tab classification
  const isCompletedStatus = (status: Transfer['status']) => status === 'Received' || status === 'Closed';

  const activeCount = transfers.filter(tr => !isCompletedStatus(tr.status)).length;
  const completedCount = transfers.filter(tr => isCompletedStatus(tr.status)).length;

  const filteredTransfers = transfers.filter(tr => {
    const query = searchQuery.toLowerCase().trim();
    const matchesQuery = !query || 
      tr.transferNumber.toLowerCase().includes(query) ||
      tr.sourceWarehouseName.toLowerCase().includes(query) ||
      tr.destWarehouseName.toLowerCase().includes(query) ||
      tr.itemName.toLowerCase().includes(query);

    if (!matchesQuery) return false;

    if (activeTab === 'active') {
      return !isCompletedStatus(tr.status);
    } else {
      return isCompletedStatus(tr.status);
    }
  });

  // Actions for transitions
  const handleAction = async (tr: Transfer, nextStatus: Transfer['status']) => {
    // If receiving, open shortage verification modal
    if (nextStatus === 'Received') {
      openReceiveModal(tr);
      return;
    }
    await onUpdateTransferStatus(tr.id!, nextStatus);
    if (nextStatus === 'Closed') {
      setActiveTab('completed');
    }
  };

  // --- SHORTAGE RECEIVE MODAL HELPERS ---
  const openReceiveModal = (tr: Transfer) => {
    const items = tr.items && tr.items.length > 0
      ? tr.items
      : [{ itemCode: tr.itemCode, itemName: tr.itemName, qty: tr.qty }];

    const formatted = items.map(item => ({
      itemCode: item.itemCode,
      itemName: item.itemName,
      dispatchedQty: item.qty,
      receivedQty: item.receivedQty !== undefined ? item.receivedQty : item.qty,
      shortQty: item.shortQty !== undefined ? item.shortQty : 0,
      shortReason: item.shortReason || ''
    }));

    setReceiptItemsState(formatted);
    setReceivingRemarksInput(tr.receivingRemarks || 'Material received, counted, and verified.');
    setReceiveModalTransfer(tr);
  };

  const handleReceivedQtyChange = (index: number, newReceivedQty: number) => {
    setReceiptItemsState(prev => {
      const updated = [...prev];
      const item = updated[index];
      const dispatched = item.dispatchedQty;
      const rec = Math.max(0, Math.min(dispatched, newReceivedQty));
      const short = Math.max(0, dispatched - rec);
      updated[index] = {
        ...item,
        receivedQty: rec,
        shortQty: short,
        shortReason: short > 0 ? item.shortReason : ''
      };
      return updated;
    });
  };

  const handleShortReasonChange = (index: number, reason: string) => {
    setReceiptItemsState(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], shortReason: reason };
      return updated;
    });
  };

  const handleConfirmReceive = async () => {
    if (!receiveModalTransfer) return;
    const details = {
      items: receiptItemsState.map(i => ({
        itemCode: i.itemCode,
        itemName: i.itemName,
        qty: i.dispatchedQty,
        receivedQty: i.receivedQty,
        shortQty: i.shortQty,
        shortReason: i.shortReason
      })),
      receivingRemarks: receivingRemarksInput
    };

    await onUpdateTransferStatus(receiveModalTransfer.id!, 'Received', receivingRemarksInput, details);
    setReceiveModalTransfer(null);
    setActiveTab('completed');
  };

  // --- ADMIN EDIT ENTRY HELPERS ---
  const openEditModal = (tr: Transfer) => {
    setEditError('');
    const items = tr.items && tr.items.length > 0
      ? tr.items
      : [{
          itemCode: tr.itemCode,
          itemName: tr.itemName,
          qty: tr.qty,
          rate: products.find(p => p.itemCode === tr.itemCode)?.purchaseRate || 100,
          taxableValue: tr.taxableValue || ((products.find(p => p.itemCode === tr.itemCode)?.purchaseRate || 100) * tr.qty),
          gstPercent: products.find(p => p.itemCode === tr.itemCode)?.gst || 18,
          totalValue: tr.invoiceTotal || ((tr.taxableValue || ((products.find(p => p.itemCode === tr.itemCode)?.purchaseRate || 100) * tr.qty)) * (1 + (products.find(p => p.itemCode === tr.itemCode)?.gst || 18)/100))
        }];

    setEditSourceWhId(tr.sourceWarehouseId);
    setEditDestWhId(tr.destWarehouseId);
    setEditInvoiceNo(tr.invoiceNumber || '');
    setEditInvoiceDate(tr.invoiceDate || new Date().toISOString().slice(0, 10));
    setEditItems(items);
    setEditRemarks(tr.remarks || '');
    setEditingTransfer(tr);
  };

  const handleSaveEditTransfer = async () => {
    if (!editingTransfer || !onEditTransfer) return;
    if (!editSourceWhId || !editDestWhId) {
      setEditError("Source and Destination warehouses are required.");
      return;
    }
    if (editSourceWhId === editDestWhId) {
      setEditError("Source and Destination warehouses cannot be identical.");
      return;
    }
    if (editItems.length === 0) {
      setEditError("At least one product item line is required.");
      return;
    }

    const srcWh = warehouses.find(w => w.code === editSourceWhId);
    const destWh = warehouses.find(w => w.code === editDestWhId);

    const totalQty = editItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    const totalTaxable = editItems.reduce((sum, item) => sum + (Number(item.taxableValue) || 0), 0);
    const totalInvoiceVal = editItems.reduce((sum, item) => sum + (Number(item.totalValue) || 0), 0);

    const updatedData: Partial<Transfer> = {
      sourceWarehouseId: editSourceWhId,
      sourceWarehouseName: srcWh ? srcWh.name : editSourceWhId,
      destWarehouseId: editDestWhId,
      destWarehouseName: destWh ? destWh.name : editDestWhId,
      itemCode: editItems[0].itemCode,
      itemName: editItems.length > 1 ? `${editItems[0].itemName} + ${editItems.length - 1} more items` : editItems[0].itemName,
      qty: totalQty,
      items: editItems,
      invoiceNumber: editInvoiceNo,
      invoiceDate: editInvoiceDate,
      taxableValue: totalTaxable,
      invoiceTotal: totalInvoiceVal,
      remarks: editRemarks
    };

    await onEditTransfer(editingTransfer.id!, updatedData);
    setEditingTransfer(null);
  };

  // --- ADMIN UNDO ENTRY HELPERS ---
  const openUndoModal = (tr: Transfer) => {
    setUndoResetTarget('Pending Approval');
    setUndoModalTransfer(tr);
  };

  const handleConfirmUndo = async () => {
    if (!undoModalTransfer || !onUndoTransfer) return;
    await onUndoTransfer(undoModalTransfer.id!, undoResetTarget);
    setUndoModalTransfer(null);
  };

  const getStatusStyle = (status: Transfer['status']) => {
    switch (status) {
      case 'Draft': return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'Pending Approval': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'Approved': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'Dispatched': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'In Transit': return 'bg-sky-100 text-sky-800 border-sky-200 animate-pulse';
      case 'Received': return 'bg-emerald-50 text-emerald-800 border-emerald-100';
      case 'Closed': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    }
  };

  const getStepsProgress = (status: Transfer['status']) => {
    const steps = ['Draft', 'Pending Approval', 'Approved', 'Dispatched', 'In Transit', 'Received', 'Closed'];
    const activeIdx = steps.indexOf(status);
    return { steps, activeIdx };
  };

  return (
    <div id="transfer-view" className="space-y-6 animate-fade-in">
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-gray-800">Inter-Warehouse Stock Transfer Orders</h2>
          <p className="text-[10px] text-gray-500">Formulate transfer orders, process manager approvals, and log in-transit dispatches</p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search transfer no..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none w-48 shadow-xs"
          />

          {isSuperAdmin && onRearrangeSeries && (
            <button
              onClick={async () => {
                try {
                  const res = await onRearrangeSeries();
                  if (!res || res.updatedCount === 0) {
                    alert('Posted transfers are permanent and immutable. No draft transfers were found to renumber.');
                  } else {
                    alert(`Successfully rearranged draft transfer series! Updated ${res.updatedCount} transfer series numbers.`);
                  }
                } catch (e: any) {
                  alert(`Failed to rearrange transfer series: ${e.message || e}`);
                }
              }}
              className="bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-all shadow-2xs border border-amber-300"
              title="Auto Rearrange Draft Transfer Series sequentially"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
              <span>Auto Rearrange Series</span>
            </button>
          )}

          {!isViewer ? (
            <button
              onClick={openCreateForm}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              Request Stock Transfer
            </button>
          ) : (
            <span className="text-[10px] bg-slate-50 text-slate-500 font-semibold px-2 py-1.5 rounded border border-gray-200">
              Viewer Access
            </span>
          )}
        </div>
      </div>

      {/* Slide out or inline create form */}
      <AnimatePresence>
        {isFormOpen && (
          <motion.div 
            initial={{ opacity: 0, height: 0, y: -20 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="overflow-hidden mb-4"
          >
            <div className="bg-white border border-indigo-100 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
                <h3 className="font-extrabold text-xs text-indigo-700 flex items-center gap-1.5">
                  <ArrowLeftRight className="w-4 h-4" />
                  Draft New Warehouse Transfer Request
                </h3>
                <button onClick={() => setIsFormOpen(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

          {formError && (
            <div className="bg-rose-50 border border-rose-100 text-rose-800 text-xs p-3 rounded-lg font-semibold mb-4">
              ⚠️ {formError}
            </div>
          )}

          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            {/* Transfer Series Ref No */}
            <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-indigo-900 uppercase block mb-1">
                  Transfer Series Ref No. (Must be unique) *
                </label>
                <input
                  type="text"
                  required
                  value={customTransferNumber}
                  onChange={(e) => setCustomTransferNumber(e.target.value)}
                  placeholder="e.g. TRF-1001"
                  className="w-full sm:w-64 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-indigo-700 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <p className="text-[10px] text-indigo-600 font-semibold max-w-xs">
                ★ Guaranteed unique sequential transfer reference. Posted document numbers remain permanent and immutable.
              </p>
            </div>

            {primaryWh && !isLoggedIntoSecondary && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex flex-col gap-1">
                <span className="font-bold flex items-center gap-1">⭐ Primary Warehouse Supply Directive Active</span>
                <span>All outbound goods transfers must originate from the Primary Warehouse (<strong>{primaryWh.name}</strong>). A matching Supply Tax Invoice (INV) will be automatically generated upon dispatch.</span>
              </div>
            )}
            {isLoggedIntoSecondary && (
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 text-xs text-sky-800 flex flex-col gap-1">
                <span className="font-bold flex items-center gap-1 text-sky-900">🔄 Secondary-to-Any Warehouse Transfer Authorized</span>
                <span>You are currently operating within a Secondary Warehouse context. You can transfer available stock to any other facility, including the Central Primary Warehouse.</span>
              </div>
            )}

            {/* Warehouse Selection */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="md:col-span-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Source Warehouse</label>
                <select
                  required
                  disabled={shouldRestrictWarehouse || isLoggedIntoSecondary ? true : (!!primaryWh)} // Lock to logged-in secondary or primary warehouse
                  value={sourceWhId}
                  onChange={(e) => {
                    setSourceWhId(e.target.value);
                    setFormItems([]); // Reset items list if warehouse changes
                  }}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-700 font-semibold disabled:opacity-80 disabled:bg-gray-100"
                >
                  {shouldRestrictWarehouse ? (
                    warehouses.filter(w => w.code === currentWarehouseId).map((w, idx) => (
                      <option key={`${w.id || w.code}-${idx}`} value={w.code}>{w.name} {w.isPrimary ? '(★ Primary)' : '(Secondary)'}</option>
                    ))
                  ) : (
                    warehouses.map((w, idx) => (
                      <option key={`${w.id || w.code}-${idx}`} value={w.code}>{w.name} {w.isPrimary ? '(★ Primary)' : '(Secondary)'}</option>
                    ))
                  )}
                </select>
              </div>

              <div className="flex items-center justify-center hidden md:flex text-indigo-400">
                <ArrowRight className="w-5 h-5 animate-pulse" />
              </div>

              <div className="md:col-span-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Destination Warehouse</label>
                <select
                  required
                  value={destWhId}
                  onChange={(e) => setDestWhId(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-700 font-semibold"
                >
                  {warehouses.filter(w => w.code !== sourceWhId).map((w, idx) => (
                    <option key={`${w.id || w.code}-${idx}`} value={w.code}>{w.name} {w.isPrimary ? '(★ Primary)' : '(Secondary)'}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Product Item Entry */}
            <div className="bg-indigo-50/50 border border-indigo-100 p-4 rounded-xl space-y-3">
              <h4 className="text-[11px] font-extrabold text-indigo-700 uppercase tracking-wider">
                1. Select Products & Add to Transfer List
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-6">
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Product SKU to Transfer</label>
                  <select
                    value={itemCode}
                    onChange={(e) => setItemCode(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-700 font-semibold"
                  >
                    <option value="">-- Select Product SKU --</option>
                    {products.map(p => {
                      const stock = stocks.find(s => s.itemCode === p.itemCode && s.warehouseId === sourceWhId);
                      const available = stock ? getLiveAvailableQty(stock, warehouses) : 0;
                      const sourceWh = warehouses.find(w => w.code === sourceWhId);
                      const labelStock = sourceWh?.isPrimary 
                        ? `Primary Supply: ${available} ${p.unit} (No Limit)` 
                        : `Stock: ${available} ${p.unit}`;
                      return (
                        <option key={p.itemCode} value={p.itemCode}>
                          {p.name} ({labelStock})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Quantity</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={qty}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      setQty(val);
                    }}
                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono font-bold"
                    placeholder="Qty (numbers only)"
                  />
                </div>

                <div className="md:col-span-3">
                  <button
                    type="button"
                    onClick={handleAddItemToList}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center justify-center gap-1 cursor-pointer transition-colors shadow-xs"
                  >
                    <Plus className="w-4 h-4" /> Add Item
                  </button>
                </div>
              </div>
            </div>

            {/* Added Items List Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
              <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex justify-between items-center">
                <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">
                  2. Current Transfer Items ({formItems.length})
                </span>
                <span className="text-[10px] text-gray-500 font-mono">
                  Source: {warehouses.find(w => w.code === sourceWhId)?.name || 'None'}
                </span>
              </div>

              {formItems.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-xs">
                  No products added yet. Select a product above and click "Add Item".
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase">
                        <th className="p-3">SKU</th>
                        <th className="p-3">Product Name</th>
                        <th className="p-3 text-center">Qty</th>
                        <th className="p-3 text-right">Rate</th>
                        <th className="p-3 text-right">Taxable Val</th>
                        <th className="p-3 text-right">GST %</th>
                        <th className="p-3 text-right">GST Amt</th>
                        <th className="p-3 text-right">Total Val</th>
                        <th className="p-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formItems.map((item) => (
                        <tr key={item.itemCode} className="border-b border-slate-100 hover:bg-slate-50/50">
                          <td className="p-3 font-mono font-bold text-slate-700">{item.itemCode}</td>
                          <td className="p-3 font-semibold text-slate-800">{item.itemName}</td>
                          <td className="p-3 text-center font-bold font-mono text-indigo-700">{item.qty}</td>
                          <td className="p-3 text-right font-mono">${item.rate.toFixed(2)}</td>
                          <td className="p-3 text-right font-mono">${item.taxableValue.toFixed(2)}</td>
                          <td className="p-3 text-right font-mono">{item.gstPercent}%</td>
                          <td className="p-3 text-right font-mono text-slate-500">${item.gstAmount.toFixed(2)}</td>
                          <td className="p-3 text-right font-bold font-mono text-emerald-700">${item.totalValue.toFixed(2)}</td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveItemFromList(item.itemCode)}
                              className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 transition-colors"
                            >
                              <X className="w-4 h-4 mx-auto" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Invoice wise entry section */}
            {formItems.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-slate-200 p-4 rounded-xl bg-slate-50/50">
                <div className="md:col-span-2 space-y-3">
                  <h4 className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    3. Supply Invoice Wise Details
                  </h4>
                  <p className="text-[10px] text-gray-500">
                    Provide custom invoice details for inter-state tax transfer mapping if required. If left blank, these will auto-generate.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Custom Invoice Number</label>
                      <input
                        type="text"
                        placeholder="e.g. INV-2026-X99"
                        value={customInvoiceNo}
                        onChange={(e) => setCustomInvoiceNo(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Invoice Date</label>
                      <input
                        type="date"
                        value={customInvoiceDate}
                        onChange={(e) => setCustomInvoiceDate(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Live Invoice Tax Summary */}
                <div className="bg-white border border-indigo-100 p-4 rounded-xl flex flex-col justify-between shadow-xs">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Live Invoice Summary</span>
                  <div className="space-y-1.5 py-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Subtotal (Taxable):</span>
                      <span className="font-mono font-medium">${formSubtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">GST Amount:</span>
                      <span className="font-mono font-medium text-slate-600">${formGstTotal.toFixed(2)}</span>
                    </div>
                    <div className="border-t border-dashed border-gray-100 pt-1.5 flex justify-between text-xs font-extrabold">
                      <span className="text-slate-800">Grand Total:</span>
                      <span className="font-mono text-emerald-700 text-sm">${formGrandTotal.toFixed(2)}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-indigo-500 font-semibold bg-indigo-50 rounded px-1.5 py-0.5 text-center">
                    Invoice value matches double-entry bookkeeping ledgers.
                  </span>
                </div>
              </div>
            )}

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Internal Transfer Remarks</label>
              <textarea
                rows={2}
                required
                placeholder="Fulfilling stock replenishment constraints."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-50 pt-3">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="px-3 py-1.5 border border-gray-200 text-gray-700 text-xs font-semibold rounded-lg cursor-pointer hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={(e) => handleCreateTransfer(e, true)}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold rounded-lg cursor-pointer transition-colors"
              >
                Save Draft
              </button>
              <button
                type="button"
                onClick={(e) => handleCreateTransfer(e, false)}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors"
              >
                Submit for Approval
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    )}
  </AnimatePresence>

      {/* Main List & Workflow Details */}
      <div className="space-y-4">
        {/* Active vs Completed Tab Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 p-2.5 rounded-xl">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('active')}
              className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'active'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>In-Progress Transfers</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                activeTab === 'active' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700'
              }`}>
                {activeCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('completed')}
              className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'completed'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Completed Transfers</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                activeTab === 'completed' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'
              }`}>
                {completedCount}
              </span>
            </button>
          </div>

          <div className="text-[11px] text-slate-500 font-medium px-2">
            Showing <strong className="text-slate-800 font-bold">{filteredTransfers.length}</strong> {activeTab === 'active' ? 'in-progress' : 'completed'} order(s)
          </div>
        </div>

        {filteredTransfers.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-gray-400 text-xs flex flex-col items-center justify-center gap-2">
            {activeTab === 'active' ? (
              <>
                <Clock className="w-8 h-8 text-slate-300" />
                <span>No active/in-progress material transfers found.</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-8 h-8 text-emerald-300" />
                <span>No completed material transfers found yet. When a transfer is received or closed, it will move here.</span>
              </>
            )}
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filteredTransfers.map((tr) => {
              const { steps, activeIdx } = getStepsProgress(tr.status);
              const isExpanded = !!expandedTransferIds[tr.id];

              return (
                <motion.div
                  key={tr.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <Swipeable
                    onSwipeRight={() => setPrintingTransfer(tr)}
                    onSwipeLeft={currentUserRole === 'Super Admin' ? () => {
                      if (window.confirm(`Are you sure you want to delete Transfer request "${tr.transferNumber}"? This action cannot be undone.`)) {
                        onDeleteTransfer(tr.id);
                      }
                    } : undefined}
                    leftLabel="Print Slip"
                    leftBgColor="bg-indigo-600"
                    leftIcon={<Printer className="w-4 h-4 text-white" />}
                    rightLabel="Delete"
                    rightBgColor="bg-rose-600"
                  >
                    <div className="bg-white rounded-xl border border-gray-150 hover:border-indigo-200 shadow-xs p-4 transition-all h-full">
                      
                      {/* Collapsed Header Row (Click anywhere on header to expand/collapse) */}
                      <div 
                        onClick={() => toggleExpand(tr.id)}
                        className="flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer select-none"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-indigo-700 text-xs bg-indigo-50 px-2.5 py-1 rounded-full">
                            {tr.transferNumber}
                          </span>
                          <span className={`text-[9px] font-extrabold px-2.5 py-0.5 rounded-full border ${getStatusStyle(tr.status)}`}>
                            {tr.status}
                          </span>

                          {(tr.hasShortage || (tr.totalShortQty && tr.totalShortQty > 0)) && (
                            <span className="font-extrabold text-[10px] bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-2xs">
                              ⚠️ {tr.totalShortQty} Pcs Short Received
                            </span>
                          )}
                          
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                            <span className="text-indigo-900 font-bold">{tr.sourceWarehouseName}</span>
                            <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="text-emerald-900 font-bold">{tr.destWarehouseName}</span>
                          </div>

                          <div className="text-xs font-bold text-slate-800 ml-1">
                            {tr.itemName} <span className="text-slate-400 font-normal font-mono text-[11px]">({tr.qty} Pcs)</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setPrintingTransfer(tr)}
                            className="p-1.5 text-gray-500 hover:text-indigo-600 bg-gray-50 rounded-lg hover:bg-indigo-50/50 cursor-pointer transition-colors text-[10px] font-bold flex items-center gap-1 border border-gray-100"
                          >
                            <Printer className="w-3.5 h-3.5" /> Print
                          </button>
                          {currentUserRole === 'Super Admin' && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Are you sure you want to delete Transfer request "${tr.transferNumber}"? This action cannot be undone.`)) {
                                  onDeleteTransfer(tr.id);
                                }
                              }}
                              className="p-1.5 text-gray-500 hover:text-rose-600 bg-gray-50 rounded-lg hover:bg-rose-50 cursor-pointer transition-colors text-[10px] font-bold flex items-center gap-1 border border-gray-100"
                              title="Delete Transfer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => toggleExpand(tr.id)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all border ${
                              isExpanded 
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700' 
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <span>{isExpanded ? 'Hide Details' : 'View Details'}</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Hidden data shown when clicked on */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="overflow-hidden space-y-4 pt-4 mt-3 border-t border-slate-100"
                          >
                            {/* Logistics details */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-medium">
                              <div>
                                <span className="text-[10px] font-bold text-gray-400 block uppercase mb-0.5">Source location</span>
                                <span className="text-gray-800 font-bold text-indigo-900">{tr.sourceWarehouseName}</span>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold text-gray-400 block uppercase mb-0.5">destination</span>
                                <span className="text-gray-800 font-bold text-emerald-900">{tr.destWarehouseName}</span>
                              </div>
                              <div className="md:col-span-2">
                                <span className="text-[10px] font-bold text-gray-400 block uppercase mb-0.5">Summary</span>
                                <span className="text-indigo-700 font-bold block">{tr.itemName}</span>
                                <span className="text-[10px] text-gray-500 font-mono">Total Cumulative Quantity: <strong className="font-bold text-slate-800 text-xs">{tr.qty} Pcs</strong></span>
                              </div>

                              {/* Multi-item Breakdown Table inside the transfer card */}
                              <div className="md:col-span-4 border-t border-slate-100 pt-3">
                                <span className="text-[10px] font-bold text-slate-400 block uppercase mb-2">Transferred Items Lines & Taxes Breakdown</span>
                                <div className="border border-slate-150 rounded-lg overflow-x-auto bg-slate-50/40">
                                  <table className="w-full text-left border-collapse text-[11px]">
                                    <thead>
                                      <tr className="bg-slate-100/80 border-b border-slate-150 text-slate-500 font-bold text-[9px] uppercase">
                                        <th className="p-2">SKU</th>
                                        <th className="p-2">Product Name</th>
                                        <th className="p-2 text-center">Dispatched</th>
                                        {(tr.status === 'Received' || tr.status === 'Closed') && (
                                          <>
                                            <th className="p-2 text-center">Received</th>
                                            <th className="p-2 text-center">Short</th>
                                            <th className="p-2">Shortage Reason</th>
                                          </>
                                        )}
                                        <th className="p-2 text-right">Rate</th>
                                        <th className="p-2 text-right">Taxable</th>
                                        <th className="p-2 text-right">GST %</th>
                                        <th className="p-2 text-right">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {((tr.items && tr.items.length > 0)
                                        ? tr.items
                                        : [{
                                            itemCode: tr.itemCode,
                                            itemName: tr.itemName,
                                            qty: tr.qty,
                                            rate: products.find(p => p.itemCode === tr.itemCode)?.purchaseRate || 100,
                                            taxableValue: tr.taxableValue || ((products.find(p => p.itemCode === tr.itemCode)?.purchaseRate || 100) * tr.qty),
                                            gstPercent: products.find(p => p.itemCode === tr.itemCode)?.gst || 18,
                                            totalValue: tr.invoiceTotal || ((tr.taxableValue || ((products.find(p => p.itemCode === tr.itemCode)?.purchaseRate || 100) * tr.qty)) * (1 + (products.find(p => p.itemCode === tr.itemCode)?.gst || 18)/100))
                                          }]
                                      ).map((item, idx) => (
                                        <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/50">
                                          <td className="p-2 font-mono font-bold text-slate-600">{item.itemCode}</td>
                                          <td className="p-2 text-slate-800 font-semibold">{item.itemName}</td>
                                          <td className="p-2 text-center font-bold text-indigo-700 font-mono">{item.qty} Pcs</td>
                                          {(tr.status === 'Received' || tr.status === 'Closed') && (
                                            <>
                                              <td className="p-2 text-center font-bold text-emerald-700 font-mono">
                                                {item.receivedQty !== undefined ? item.receivedQty : item.qty} Pcs
                                              </td>
                                              <td className="p-2 text-center font-mono">
                                                {(item.shortQty && item.shortQty > 0) ? (
                                                  <span className="font-extrabold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
                                                    -{item.shortQty} Pcs
                                                  </span>
                                                ) : (
                                                  <span className="text-slate-400">0</span>
                                                )}
                                              </td>
                                              <td className="p-2 text-slate-600 italic text-[10px]">
                                                {item.shortReason || (item.shortQty && item.shortQty > 0 ? 'Shortage logged' : '-')}
                                              </td>
                                            </>
                                          )}
                                          <td className="p-2 text-right font-mono">₹{(item.rate || 100).toFixed(2)}</td>
                                          <td className="p-2 text-right font-mono">₹{(item.taxableValue || ((item.rate || 100) * item.qty)).toFixed(2)}</td>
                                          <td className="p-2 text-right font-mono">{item.gstPercent || 18}%</td>
                                          <td className="p-2 text-right font-bold font-mono text-emerald-700">
                                            ₹{(item.totalValue || ((item.taxableValue || ((item.rate || 100) * item.qty)) * (1 + (item.gstPercent || 18)/100))).toFixed(2)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>

                            {/* Invoice Reference if from primary */}
                            {tr.invoiceNumber && (
                              <div className="bg-amber-50/40 border border-amber-100 rounded-lg px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
                                <div className="flex items-center gap-1.5 text-amber-900 font-semibold">
                                  <FileText className="w-4 h-4 text-amber-600" />
                                  <span>Supply Invoice: <strong className="font-mono text-indigo-700 bg-indigo-50/80 px-1.5 py-0.5 rounded-sm">{tr.invoiceNumber}</strong></span>
                                </div>
                                <div className="flex items-center gap-3 font-medium text-slate-600">
                                  <span>Date: <strong className="text-slate-800">{tr.invoiceDate}</strong></span>
                                  <span>Total Value: <strong className="text-emerald-700 font-bold">₹{tr.invoiceTotal?.toFixed(2)}</strong> <span className="text-[10px] text-slate-400 font-normal">(incl. GST)</span></span>
                                </div>
                              </div>
                            )}

                            {/* Progress Workflow Bar */}
                            <div className="bg-slate-50/50 border border-gray-100 rounded-xl p-4">
                              <div className="flex flex-wrap items-center gap-2 justify-between text-[9px] font-bold text-gray-400 uppercase mb-3">
                                <span>Workflow Progress Bar:</span>
                                <span className="text-indigo-600 font-extrabold">Active Status: {tr.status}</span>
                              </div>
                              <div className="flex items-center justify-between relative mt-2">
                                {/* Background line */}
                                <div className="absolute left-0 right-0 h-0.5 bg-gray-200 -z-0" />
                                <div className="absolute left-0 h-0.5 bg-indigo-500 -z-0 transition-all duration-300" style={{ width: `${(activeIdx / (steps.length - 1)) * 100}%` }} />

                                {steps.map((st, i) => {
                                  const isCompleted = i < activeIdx;
                                  const isActive = i === activeIdx;
                                  return (
                                    <div key={st} className="flex flex-col items-center relative z-10">
                                      <div className={`w-5 h-5 rounded-full flex items-center justify-center border font-mono text-[9px] font-extrabold transition-all duration-300 ${
                                        isCompleted ? 'bg-indigo-600 border-indigo-600 text-white' :
                                        isActive ? 'bg-white border-indigo-600 text-indigo-700 ring-2 ring-indigo-100 shadow' :
                                        'bg-white border-gray-200 text-gray-400'
                                      }`}>
                                        {isCompleted ? '✓' : i + 1}
                                      </div>
                                      <span className={`text-[8px] mt-1.5 font-bold ${isActive ? 'text-indigo-600' : 'text-gray-400'} hidden sm:block`}>
                                        {st}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Action Buttons Based on Role Constraints & Active State */}
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-t border-gray-50 pt-3">
                              <div className="text-[10px] text-gray-500 font-medium">
                                Requested by: <strong className="text-gray-700">{tr.createdBy}</strong> on {new Date(tr.createdAt).toLocaleDateString()}
                              </div>

                              <div className="flex gap-2 flex-wrap ml-auto">
                                {/* 1. If Draft */}
                                {tr.status === 'Draft' && isStoreOperator && (
                                  <button
                                    type="button"
                                    onClick={() => handleAction(tr, 'Pending Approval')}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                                  >
                                    <Send className="w-3.5 h-3.5" /> Submit for Approval
                                  </button>
                                )}

                                {/* 2. If Pending Approval */}
                                {tr.status === 'Pending Approval' && isManager && (
                                  <button
                                    type="button"
                                    onClick={() => handleAction(tr, 'Approved')}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                                  >
                                    <Check className="w-3.5 h-3.5" /> Approve Transfer
                                  </button>
                                )}

                                {/* 3. If Approved */}
                                {tr.status === 'Approved' && isStoreOperator && (
                                  <button
                                    type="button"
                                    onClick={() => handleAction(tr, 'Dispatched')}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                                  >
                                    <Play className="w-3.5 h-3.5" /> Dispatch Material
                                  </button>
                                )}

                                {/* 4. If Dispatched */}
                                {tr.status === 'Dispatched' && (
                                  <button
                                    type="button"
                                    onClick={() => handleAction(tr, 'In Transit')}
                                    className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                                  >
                                    <ArrowLeftRight className="w-3.5 h-3.5" /> Set In-Transit
                                  </button>
                                )}

                                {/* 5. Receive Material Option (Available when In Transit or Dispatched) */}
                                {(tr.status === 'In Transit' || tr.status === 'Dispatched') && isStoreOperator && (
                                  <button
                                    type="button"
                                    onClick={() => openReceiveModal(tr)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                                  >
                                    <CheckSquare className="w-3.5 h-3.5" /> Receive Material & Verify Qty
                                  </button>
                                )}

                                {/* 6. If Received */}
                                {tr.status === 'Received' && isManager && (
                                  <button
                                    type="button"
                                    onClick={() => handleAction(tr, 'Closed')}
                                    className="bg-slate-800 hover:bg-slate-900 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                                  >
                                    ✓ Close Transfer Document
                                  </button>
                                )}

                                {/* ADMIN AUTHORITY: Edit Transfer Entry Before Dispatch */}
                                {isAdmin && (tr.status === 'Draft' || tr.status === 'Pending Approval' || tr.status === 'Approved') && onEditTransfer && (
                                  <button
                                    type="button"
                                    onClick={() => openEditModal(tr)}
                                    className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                                    title="Admin Authority: Edit transfer order details before dispatch"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" /> Edit Entry
                                  </button>
                                )}

                                {/* ADMIN AUTHORITY: Undo Entry */}
                                {isAdmin && tr.status !== 'Draft' && onUndoTransfer && (
                                  <button
                                    type="button"
                                    onClick={() => openUndoModal(tr)}
                                    className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                                    title="Admin Authority: Undo entry and revert stock balances"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" /> Undo Entry
                                  </button>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </Swipeable>
                </motion.div>
              );
            })}
          </AnimatePresence>
  )}
</div>

      {/* SIMULATED SLIP MODAL */}
      <AnimatePresence>
        {printingTransfer && (() => {
          const prod = products.find(p => p.itemCode === printingTransfer.itemCode);
          return (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50"
            >
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 25 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 25 }}
                transition={{ type: 'spring', damping: 25, stiffness: 320 }}
                className="bg-white rounded-xl border border-gray-100 shadow-xl max-w-2xl w-full p-6 space-y-4 relative overflow-y-auto max-h-[90vh]"
              >
                <button
                  onClick={() => setPrintingTransfer(null)}
                  className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-50 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>

              {/* Slip Header */}
              <div className="text-center border-b border-gray-200 pb-4">
                {printingTransfer.invoiceNumber ? (
                  <>
                    <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">STOCK TRANSFER TAX INVOICE</h2>
                    <p className="text-[10px] text-amber-600 font-bold mt-1">⭐ Primary Warehouse Inter-State Supply Document</p>
                  </>
                ) : (
                  <>
                    <h2 className="text-sm font-extrabold text-slate-900 uppercase">INTER-WAREHOUSE MATERIAL TRANSFER SLIP</h2>
                    <p className="text-[10px] text-gray-500 font-mono mt-1">Generated via cloud-based inventory synchronization console</p>
                  </>
                )}
              </div>

              {/* Transfer Meta */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-[9px] font-bold text-gray-400 block uppercase">Transfer Order No:</span>
                  <strong className="text-indigo-700 font-bold font-mono">{printingTransfer.transferNumber}</strong>
                  {printingTransfer.invoiceNumber && (
                    <div className="mt-1">
                      <span className="text-[9px] font-bold text-gray-400 block uppercase">Supply Invoice No:</span>
                      <strong className="text-amber-700 font-bold font-mono">{printingTransfer.invoiceNumber}</strong>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[9px] font-bold text-gray-400 block uppercase">Created Date:</span>
                  <strong className="text-slate-700 font-semibold">{new Date(printingTransfer.createdAt).toLocaleDateString()}</strong>
                  {printingTransfer.invoiceDate && (
                    <div className="mt-1">
                      <span className="text-[9px] font-bold text-gray-400 block uppercase">Invoice Date:</span>
                      <strong className="text-slate-700 font-semibold">{printingTransfer.invoiceDate}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Logistics details table / Billing Address */}
              <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
                <div className="grid grid-cols-2 bg-gray-50 border-b border-gray-200 p-2.5 font-bold uppercase text-[9px] text-gray-400">
                  <span>Supplier (From Primary Hub)</span>
                  <span>Consignee (To Secondary Branch)</span>
                </div>
                <div className="grid grid-cols-2 p-2.5 font-medium text-gray-800 gap-3">
                  <div className="space-y-1">
                    <strong className="text-slate-900 font-bold block">{printingTransfer.sourceWarehouseName}</strong>
                    <span className="text-[10px] text-gray-500 block leading-tight">
                      Address: {warehouses.find(w => w.code === printingTransfer.sourceWarehouseId)?.address || 'Sector-5, Kalamboli Logistics Zone, Mumbai'}
                    </span>
                    <span className="text-[10px] text-gray-500 block">GSTIN: <strong className="font-mono text-slate-700">27AAAAA1111A1Z1</strong> (Primary Hub)</span>
                  </div>
                  <div className="space-y-1">
                    <strong className="text-slate-900 font-bold block">{printingTransfer.destWarehouseName}</strong>
                    <span className="text-[10px] text-gray-500 block leading-tight">
                      Address: {warehouses.find(w => w.code === printingTransfer.destWarehouseId)?.address || 'Regional Logistics Area'}
                    </span>
                    <span className="text-[10px] text-gray-500 block">GSTIN: <strong className="font-mono text-slate-700">27BBBBB2222B2Z2</strong></span>
                  </div>
                </div>
              </div>

              {/* Material description table / Invoice values */}
              {printingTransfer.invoiceNumber ? (
                <div className="space-y-3">
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs text-left border-collapse overflow-hidden">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-[9px] font-bold text-gray-400 uppercase">
                          <th className="p-2">Item SKU</th>
                          <th className="p-2">Description</th>
                          <th className="p-2 text-center">Qty</th>
                          <th className="p-2 text-right">Rate</th>
                          <th className="p-2 text-right">Taxable Amt</th>
                          <th className="p-2 text-right">GST %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {((printingTransfer.items && printingTransfer.items.length > 0)
                          ? printingTransfer.items
                          : [{
                              itemCode: printingTransfer.itemCode,
                              itemName: printingTransfer.itemName,
                              qty: printingTransfer.qty,
                              rate: prod?.purchaseRate || 100,
                              taxableValue: printingTransfer.taxableValue || 0,
                              gstPercent: prod?.gst || 18,
                              gstAmount: printingTransfer.gstAmount || 0,
                              totalValue: printingTransfer.invoiceTotal || 0
                            }]
                        ).map((item, idx) => (
                          <tr key={idx} className="font-medium text-gray-800 border-b border-gray-100">
                            <td className="p-2 font-mono text-[11px]">{item.itemCode}</td>
                            <td className="p-2 text-[11px]">{item.itemName}</td>
                            <td className="p-2 text-center font-mono">{item.qty}</td>
                            <td className="p-2 text-right font-mono">₹{(item.rate || 100).toFixed(2)}</td>
                            <td className="p-2 text-right font-mono">₹{(item.taxableValue || 0).toFixed(2)}</td>
                            <td className="p-2 text-right font-mono">{item.gstPercent || 18}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Totals Breakdown */}
                  <div className="flex justify-end pt-2">
                    <div className="w-1/2 border border-gray-200 rounded-lg overflow-hidden text-xs font-semibold">
                      <div className="grid grid-cols-2 p-1.5 border-b border-gray-100 text-gray-500">
                        <span>Taxable Value:</span>
                        <span className="text-right font-mono text-slate-700">₹{(printingTransfer.taxableValue || 0).toFixed(2)}</span>
                      </div>
                      <div className="grid grid-cols-2 p-1.5 border-b border-gray-100 text-gray-500">
                        <span>GST Amount:</span>
                        <span className="text-right font-mono text-slate-700">₹{(printingTransfer.gstAmount || 0).toFixed(2)}</span>
                      </div>
                      <div className="grid grid-cols-2 p-1.5 bg-indigo-50/40 text-indigo-950 font-extrabold">
                        <span>Grand Total:</span>
                        <span className="text-right font-mono">₹{(printingTransfer.invoiceTotal || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-xs text-left border-collapse overflow-hidden">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-[9px] font-bold text-gray-400 uppercase">
                        <th className="p-2.5">SKU / Item Code</th>
                        <th className="p-2.5">Product Name</th>
                        <th className="p-2.5 text-center">Qty Sent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((printingTransfer.items && printingTransfer.items.length > 0)
                        ? printingTransfer.items
                        : [{
                            itemCode: printingTransfer.itemCode,
                            itemName: printingTransfer.itemName,
                            qty: printingTransfer.qty
                          }]
                      ).map((item, idx) => (
                        <tr key={idx} className="font-medium text-gray-800 border-b border-gray-150 hover:bg-slate-50">
                          <td className="p-2.5 font-mono">{item.itemCode}</td>
                          <td className="p-2.5">{item.itemName}</td>
                          <td className="p-2.5 text-center font-bold font-mono text-indigo-700 bg-indigo-50/20">{item.qty} Units</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Status signatures */}
              <div className="border-t border-gray-200 pt-4 grid grid-cols-3 gap-3 text-[10px] text-center font-medium">
                <div className="border border-gray-100 rounded-lg p-2 bg-gray-50">
                  <span className="text-[8px] font-bold text-gray-400 block uppercase">Prepared By</span>
                  <span className="text-gray-700 truncate block mt-1">{printingTransfer.createdBy}</span>
                </div>
                <div className="border border-gray-100 rounded-lg p-2 bg-gray-50">
                  <span className="text-[8px] font-bold text-gray-400 block uppercase">Approved By</span>
                  <span className="text-gray-700 truncate block mt-1">{printingTransfer.approvedBy || 'Pending...'}</span>
                </div>
                <div className="border border-gray-100 rounded-lg p-2 bg-gray-50">
                  <span className="text-[8px] font-bold text-gray-400 block uppercase">Status verified</span>
                  <span className="text-emerald-700 font-bold block mt-1 uppercase">{printingTransfer.status}</span>
                </div>
              </div>

              {/* Print Action */}
              <div className="flex gap-2 justify-end border-t border-gray-100 pt-4">
                <button
                  onClick={() => setPrintingTransfer(null)}
                  className="px-4 py-2 border border-gray-200 text-gray-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Close
                </button>
                <button
                  onClick={() => { window.print(); }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Send to Printer
                </button>
              </div>
            </motion.div>
          </motion.div>
        );
      })()}
      </AnimatePresence>

      {/* 1. RECEIVE WITH SHORTAGE MODAL */}
      <AnimatePresence>
        {receiveModalTransfer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full p-6 space-y-5 relative max-h-[90vh] overflow-y-auto"
            >
              <button
                onClick={() => setReceiveModalTransfer(null)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                  <CheckSquare className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Receive Material & Record Shortages
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    Transfer Order: <strong className="text-indigo-600">{receiveModalTransfer.transferNumber}</strong> ({receiveModalTransfer.sourceWarehouseName} ➔ {receiveModalTransfer.destWarehouseName})
                  </p>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Shortage Protocol:</strong> Enter the actual physically received quantity for each item line. If received quantity is less than dispatched quantity, the system will automatically record the short quantity and log a "Transfer Shortage" stock ledger movement.
                </span>
              </div>

              {/* Items Verification Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                      <th className="p-3">Product Name</th>
                      <th className="p-3 text-center">Dispatched Qty</th>
                      <th className="p-3 text-center w-32">Received Qty</th>
                      <th className="p-3 text-center">Short Qty</th>
                      <th className="p-3">Shortage Reason / Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiptItemsState.map((item, idx) => (
                      <tr key={idx} className="border-b border-slate-200 bg-white hover:bg-slate-50">
                        <td className="p-3 font-semibold text-slate-800">
                          <div className="font-bold text-slate-900">{item.itemName}</div>
                          <div className="text-[10px] font-mono text-slate-400">{item.itemCode}</div>
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-indigo-700 bg-indigo-50/30">
                          {item.dispatchedQty} Pcs
                        </td>
                        <td className="p-3 text-center">
                          <input
                            type="number"
                            min="0"
                            max={item.dispatchedQty}
                            value={item.receivedQty}
                            onChange={(e) => handleReceivedQtyChange(idx, Number(e.target.value))}
                            className="w-24 text-center bg-white border border-slate-300 rounded-lg py-1 px-2 font-mono font-extrabold text-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                          />
                        </td>
                        <td className="p-3 text-center font-mono">
                          {item.shortQty > 0 ? (
                            <span className="font-extrabold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full text-xs">
                              -{item.shortQty} Pcs
                            </span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="p-3">
                          <input
                            type="text"
                            disabled={item.shortQty === 0}
                            placeholder={item.shortQty > 0 ? "Enter reason (e.g., Transit damage, Box missing)" : "No shortage"}
                            value={item.shortReason}
                            onChange={(e) => handleShortReasonChange(idx, e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* General Remarks */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Receiving Remarks / GRN Notes</label>
                <input
                  type="text"
                  value={receivingRemarksInput}
                  onChange={(e) => setReceivingRemarksInput(e.target.value)}
                  placeholder="Enter receiving confirmation remarks..."
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  onClick={() => setReceiveModalTransfer(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmReceive}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckSquare className="w-4 h-4" /> Confirm Receipt & Update Stock
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. ADMIN EDIT TRANSFER ENTRY MODAL */}
      <AnimatePresence>
        {editingTransfer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 space-y-4 relative max-h-[90vh] overflow-y-auto"
            >
              <button
                onClick={() => setEditingTransfer(null)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Admin Authority: Edit Pre-Dispatch Transfer Order
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    Editing Order: <strong className="text-indigo-600">{editingTransfer.transferNumber}</strong>
                  </p>
                </div>
              </div>

              {editError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs font-bold">
                  {editError}
                </div>
              )}

              {/* Warehouse selections */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Source Warehouse</label>
                  <select
                    value={editSourceWhId}
                    onChange={(e) => setEditSourceWhId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-bold focus:ring-1 focus:ring-amber-500 focus:outline-none"
                  >
                    {warehouses.map(w => (
                      <option key={w.id} value={w.code}>{w.name} ({w.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Destination Warehouse</label>
                  <select
                    value={editDestWhId}
                    onChange={(e) => setEditDestWhId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-bold focus:ring-1 focus:ring-amber-500 focus:outline-none"
                  >
                    {warehouses.map(w => (
                      <option key={w.id} value={w.code}>{w.name} ({w.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Invoice details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Invoice / Document No</label>
                  <input
                    type="text"
                    value={editInvoiceNo}
                    onChange={(e) => setEditInvoiceNo(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Invoice Date</label>
                  <input
                    type="date"
                    value={editInvoiceDate}
                    onChange={(e) => setEditInvoiceDate(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Item quantities edit list */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 block">Item Quantities & Rates</label>
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                        <th className="p-2.5">Product</th>
                        <th className="p-2.5 text-center w-28">Quantity</th>
                        <th className="p-2.5 text-right w-28">Rate (₹)</th>
                        <th className="p-2.5 text-right">Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editItems.map((item, idx) => (
                        <tr key={idx} className="border-b border-slate-100">
                          <td className="p-2.5 font-bold text-slate-800">{item.itemName}</td>
                          <td className="p-2.5 text-center">
                            <input
                              type="number"
                              min="1"
                              value={item.qty}
                              onChange={(e) => {
                                const newQty = Math.max(1, Number(e.target.value));
                                setEditItems(prev => {
                                  const updated = [...prev];
                                  const r = updated[idx].rate || 100;
                                  const gst = updated[idx].gstPercent || 18;
                                  const taxVal = r * newQty;
                                  const totVal = taxVal * (1 + gst / 100);
                                  updated[idx] = {
                                    ...updated[idx],
                                    qty: newQty,
                                    taxableValue: taxVal,
                                    totalValue: totVal
                                  };
                                  return updated;
                                });
                              }}
                              className="w-20 text-center border border-slate-300 rounded-lg py-1 px-1 font-mono font-bold text-slate-800"
                            />
                          </td>
                          <td className="p-2.5 text-right font-mono">
                            ₹{(item.rate || 100).toFixed(2)}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-emerald-700">
                            ₹{(item.totalValue || ((item.qty * (item.rate || 100)) * 1.18)).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Remarks */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 block">Modification Remarks</label>
                <input
                  type="text"
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  placeholder="Enter reason for modification..."
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  onClick={() => setEditingTransfer(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEditTransfer}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-4 h-4" /> Save Modification Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. ADMIN UNDO TRANSFER ENTRY MODAL */}
      <AnimatePresence>
        {undoModalTransfer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 relative"
            >
              <button
                onClick={() => setUndoModalTransfer(null)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Admin Authority: Undo Transfer Entry
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    Transfer Order: <strong className="text-indigo-600">{undoModalTransfer.transferNumber}</strong>
                  </p>
                </div>
              </div>

              <div className="bg-rose-50 border border-rose-200 text-rose-900 p-3.5 rounded-xl text-xs space-y-1.5">
                <strong className="block font-bold text-rose-900">⚠️ Critical Action Warning:</strong>
                <p>
                  Undoing this transfer will reverse all associated stock balances!
                </p>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-rose-800">
                  <li>If <strong>In-Transit</strong>, the in-transit stock will be removed and returned to the Source warehouse available stock.</li>
                  <li>If <strong>Received/Closed</strong>, the received stock at the Destination warehouse will be debited and returned to the Source warehouse.</li>
                  <li>Associated stock movement ledger logs for this transfer will be cleaned up.</li>
                </ul>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Reset Document Status To:</label>
                <select
                  value={undoResetTarget}
                  onChange={(e) => setUndoResetTarget(e.target.value as any)}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs font-bold focus:ring-1 focus:ring-rose-500 focus:outline-none"
                >
                  <option value="Draft">Draft (Editable initial state)</option>
                  <option value="Pending Approval">Pending Approval</option>
                  <option value="Approved">Approved</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  onClick={() => setUndoModalTransfer(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmUndo}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" /> Confirm Undo & Revert Balances
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
