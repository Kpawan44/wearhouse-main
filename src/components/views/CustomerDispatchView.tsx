import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Check, Play, Send, CheckSquare, X, ArrowUpRight, HelpCircle, FileText, Search, Truck, Info, AlertTriangle, ShieldAlert, Trash2, RotateCcw, Pencil, Lock, Save } from 'lucide-react';
import { Outward, Product, Warehouse, UserRole, Stock, Customer, getLiveAvailableQty } from '../../types';
import { Swipeable } from '../Swipeable';
import { generateNextUniqueSeries, isSeriesUnique } from '../../utils/seriesUtils';

interface CustomerDispatchViewProps {
  outwards: Outward[];
  products: Product[];
  warehouses: Warehouse[];
  stocks: Stock[];
  customers: Customer[];
  onAddOutward: (outward: Omit<Outward, 'id'>) => Promise<void>;
  onEditOutward?: (
    dispatchNumber: string,
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
    },
    updatedItems: Array<{
      itemCode: string;
      itemName: string;
      qty: number;
    }>
  ) => Promise<void>;
  onDeleteOutward: (id: string) => Promise<void>;
  onDeleteOutwardGroup?: (dispatchNumber: string) => Promise<void>;
  onRearrangeSeries?: () => Promise<any>;
  currentUserRole: UserRole;
  currentWarehouseId?: string;
}

interface GroupedDispatch {
  dispatchNumber: string;
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
  items: Array<{
    id?: string;
    itemCode: string;
    itemName: string;
    qty: number;
  }>;
}

export const CustomerDispatchView: React.FC<CustomerDispatchViewProps> = ({
  outwards,
  products,
  warehouses,
  stocks,
  customers,
  onAddOutward,
  onEditOutward,
  onDeleteOutward,
  onDeleteOutwardGroup,
  onRearrangeSeries,
  currentUserRole,
  currentWarehouseId,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  const isSuperAdmin = currentUserRole === 'Super Admin';
  const shouldRestrictWarehouse = !isSuperAdmin && !!currentWarehouseId;

  // Form Field States
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  
  // Multiple Item Rows
  const [items, setItems] = useState<Array<{ itemCode: string; qty: number | string }>>([
    { itemCode: '', qty: 1 }
  ]);

  const [vehicleNumber, setVehicleNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [transportName, setTransportName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');

  const [customDispatchNumber, setCustomDispatchNumber] = useState('');

  // Edit Voucher Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDispatch, setEditingDispatch] = useState<GroupedDispatch | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editCustomerId, setEditCustomerId] = useState('');
  const [editVehicleNumber, setEditVehicleNumber] = useState('');
  const [editDriverName, setEditDriverName] = useState('');
  const [editTransportName, setEditTransportName] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [editInvoiceNumber, setEditInvoiceNumber] = useState('');
  const [editItems, setEditItems] = useState<Array<{ itemCode: string; qty: number | string }>>([]);
  const [editError, setEditError] = useState('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  const openEditModal = (disp: GroupedDispatch) => {
    setEditingDispatch(disp);
    setEditDate(disp.date || new Date().toISOString().slice(0, 10));
    setEditCustomerId(disp.customerId || '');
    setEditVehicleNumber(disp.vehicleNumber && disp.vehicleNumber !== 'N/A' ? disp.vehicleNumber : '');
    setEditDriverName(disp.driverName && disp.driverName !== 'N/A' ? disp.driverName : '');
    setEditTransportName(disp.transportName && disp.transportName !== 'N/A' ? disp.transportName : '');
    setEditRemarks(disp.remarks || '');
    setEditInvoiceNumber(disp.invoiceNumber && disp.invoiceNumber !== 'N/A' ? disp.invoiceNumber : '');
    setEditItems(disp.items.map(it => ({ itemCode: it.itemCode, qty: it.qty })));
    setEditError('');
    setIsEditModalOpen(true);
  };

  const addEditItemRow = () => {
    setEditItems([...editItems, { itemCode: products[0]?.itemCode || '', qty: 1 }]);
  };

  const removeEditItemRow = (index: number) => {
    if (editItems.length > 1) {
      setEditItems(editItems.filter((_, idx) => idx !== index));
    }
  };

  const updateEditItemRow = (index: number, field: 'itemCode' | 'qty', value: any) => {
    const updated = [...editItems];
    if (field === 'qty') {
      const sanitized = typeof value === 'string' ? value.replace(/[^0-9.]/g, '') : value;
      updated[index].qty = sanitized;
    } else {
      updated[index].itemCode = value;
    }
    setEditItems(updated);
  };

  const handleSaveEditVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDispatch || !onEditOutward) return;
    setEditError('');

    if (!editCustomerId) {
      setEditError('Please select a customer client.');
      return;
    }

    const selectedCust = customers.find(c => c.id === editCustomerId);
    if (!selectedCust) {
      setEditError('Selected customer was not found.');
      return;
    }

    if (!editItems || editItems.length === 0) {
      setEditError('Dispatch voucher must contain at least one line item.');
      return;
    }

    // Validate Items
    const parsedItems: Array<{ itemCode: string; itemName: string; qty: number }> = [];
    const aggregateQtyMap: { [code: string]: number } = {};

    for (let i = 0; i < editItems.length; i++) {
      const row = editItems[i];
      if (!row.itemCode) {
        setEditError(`Row #${i + 1}: Please select a product SKU.`);
        return;
      }
      const numQty = typeof row.qty === 'number' ? row.qty : (parseFloat(row.qty) || 0);
      if (numQty <= 0) {
        setEditError(`Row #${i + 1}: Quantity must be greater than zero.`);
        return;
      }
      const prod = products.find(p => p.itemCode === row.itemCode);
      if (!prod) {
        setEditError(`Row #${i + 1}: Product SKU "${row.itemCode}" was not found.`);
        return;
      }
      parsedItems.push({
        itemCode: row.itemCode,
        itemName: prod.name,
        qty: numQty
      });
      aggregateQtyMap[row.itemCode] = (aggregateQtyMap[row.itemCode] || 0) + numQty;
    }

    // Inventory Check: Check available stock + original dispatched quantity
    const origQtyMap: { [code: string]: number } = {};
    editingDispatch.items.forEach(it => {
      origQtyMap[it.itemCode] = (origQtyMap[it.itemCode] || 0) + it.qty;
    });

    for (const [code, reqQty] of Object.entries(aggregateQtyMap)) {
      const prod = products.find(p => p.itemCode === code)!;
      const sourceStock = stocks.find(s => s.itemCode === code && s.warehouseId === editingDispatch.warehouseId);
      const currentAvailable = sourceStock ? getLiveAvailableQty(sourceStock, warehouses) : 0;
      const prevDispatchedForThis = origQtyMap[code] || 0;
      const maxPossible = currentAvailable + prevDispatchedForThis;

      if (reqQty > maxPossible) {
        setEditError(`STOCK LIMIT EXCEEDED: Cannot dispatch ${reqQty} Pcs of "${prod.name}" (${code}). Maximum available in ${editingDispatch.warehouseName} is ${maxPossible} Pcs (Current Available: ${currentAvailable} + Current Voucher: ${prevDispatchedForThis}).`);
        return;
      }
    }

    setIsSubmittingEdit(true);
    try {
      await onEditOutward(
        editingDispatch.dispatchNumber,
        {
          date: editDate,
          customerId: editCustomerId,
          customerName: selectedCust.name,
          warehouseId: editingDispatch.warehouseId,
          warehouseName: editingDispatch.warehouseName,
          vehicleNumber: editVehicleNumber.trim() || 'N/A',
          driverName: editDriverName.trim() || 'N/A',
          transportName: editTransportName.trim() || 'N/A',
          remarks: editRemarks.trim() || 'Customer order dispatch.',
          invoiceNumber: editInvoiceNumber.trim() || 'N/A',
        },
        parsedItems
      );
      setFormSuccess(`Dispatch voucher ${editingDispatch.dispatchNumber} updated successfully with ${parsedItems.length} item(s)!`);
      setIsEditModalOpen(false);
      setEditingDispatch(null);
    } catch (err: any) {
      setEditError(err.message || 'Failed to update dispatch voucher.');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const isAuthorized = currentUserRole === 'Super Admin' || currentUserRole === 'Store Operator';
  const primaryWh = warehouses.find(w => w.isPrimary);
  const secondaryWarehouses = warehouses.filter(w => !w.isPrimary);

  // Group individual outwards into dispatch invoices
  const groupedDispatches = useMemo(() => {
    const groups: { [num: string]: GroupedDispatch } = {};
    
    outwards.forEach((out) => {
      if (!groups[out.dispatchNumber]) {
        groups[out.dispatchNumber] = {
          dispatchNumber: out.dispatchNumber,
          date: out.date,
          customerId: out.customerId,
          customerName: out.customerName,
          warehouseId: out.warehouseId,
          warehouseName: out.warehouseName,
          vehicleNumber: out.vehicleNumber,
          driverName: out.driverName,
          transportName: out.transportName,
          remarks: out.remarks,
          invoiceNumber: out.invoiceNumber,
          items: [],
        };
      }
      groups[out.dispatchNumber].items.push({
        id: out.id,
        itemCode: out.itemCode,
        itemName: out.itemName,
        qty: out.qty,
      });
    });

    return Object.values(groups).sort((a, b) => b.dispatchNumber.localeCompare(a.dispatchNumber));
  }, [outwards]);

  const openCreateForm = () => {
    setFormError('');
    setFormSuccess('');
    setDate(new Date().toISOString().slice(0, 10));
    setCustomerId(customers[0]?.id || '');
    // Auto-select first secondary warehouse, or locked assigned warehouse
    if (shouldRestrictWarehouse && currentWarehouseId) {
      setWarehouseId(currentWarehouseId);
    } else {
      setWarehouseId(secondaryWarehouses[0]?.code || '');
    }
    // Auto-generate next guaranteed unique dispatch series number
    const existingSeriesNums = outwards.map(o => o.dispatchNumber);
    const nextUniqueNum = generateNextUniqueSeries('DSP', existingSeriesNums, 1001);
    setCustomDispatchNumber(nextUniqueNum);

    // Start with one default item row
    setItems([{ itemCode: products[0]?.itemCode || '', qty: 1 }]);
    setVehicleNumber('');
    setDriverName('');
    setTransportName('');
    setRemarks('Direct customer dispatch.');
    setInvoiceNumber('');
    setIsFormOpen(true);
  };

  // Add a line item row
  const addItemRow = () => {
    setItems([...items, { itemCode: products[0]?.itemCode || '', qty: 1 }]);
  };

  // Remove a line item row
  const removeItemRow = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, idx) => idx !== index));
    }
  };

  // Update specific item row
  const updateItemRow = (index: number, field: 'itemCode' | 'qty', value: any) => {
    const updated = [...items];
    if (field === 'qty') {
      const sanitized = typeof value === 'string' ? value.replace(/[^0-9.]/g, '') : value;
      updated[index].qty = sanitized;
    } else {
      updated[index].itemCode = value;
    }
    setItems(updated);
  };

  const handleCreateDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!isAuthorized) {
      setFormError('Access Denied. You are not authorized to dispatch stock to customers.');
      return;
    }

    if (!warehouseId) {
      setFormError('Please select a source warehouse.');
      return;
    }

    const selectedWh = warehouses.find(w => w.code === warehouseId);
    if (!selectedWh) {
      setFormError('Selected warehouse does not exist.');
      return;
    }

    // STRICT BUSINESS RULE: Only allow customer dispatches from Secondary Warehouses
    if (selectedWh.isPrimary) {
      setFormError(`CRITICAL BUSINESS RULE VIOLATION: Dispatches to customers can ONLY originate from Secondary Warehouses. Primary Warehouse (${selectedWh.name}) is restricted to bulk transfers to secondary hubs.`);
      return;
    }

    if (!customerId) {
      setFormError('Please select a customer.');
      return;
    }

    const selectedCust = customers.find(c => c.id === customerId);
    if (!selectedCust) {
      setFormError('Selected customer does not exist.');
      return;
    }

    // Validate Items and calculate aggregate quantities requested for stock checks
    const aggregateQtyMap: { [code: string]: number } = {};

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.itemCode) {
        setFormError(`Row #${i + 1}: Please select a product SKU.`);
        return;
      }
      const numQty = typeof item.qty === 'number' ? item.qty : (parseFloat(item.qty) || 0);
      if (numQty <= 0) {
        setFormError(`Row #${i + 1}: Dispatch quantity must be greater than zero.`);
        return;
      }
      aggregateQtyMap[item.itemCode] = (aggregateQtyMap[item.itemCode] || 0) + numQty;
    }

    // INVENTORY CHECK: Prevent negative stock across all aggregated quantities (Negative Sales strictly blocked in regional warehouses)
    for (const [code, requiredQty] of Object.entries(aggregateQtyMap)) {
      const selectedProd = products.find(p => p.itemCode === code);
      if (!selectedProd) {
        setFormError(`Product SKU "${code}" does not exist.`);
        return;
      }

      const sourceStock = stocks.find(s => s.itemCode === code && s.warehouseId === warehouseId);
      const available = sourceStock ? getLiveAvailableQty(sourceStock, warehouses) : 0;

      if (available < requiredQty) {
        setFormError(`NEGATIVE SALES BLOCK: Outbound sales/dispatches cannot exceed available inventory in secondary warehouses! Selected warehouse (${selectedWh.name}) only has ${available} ${selectedProd.unit || 'Pcs'}(s) of "${selectedProd.name}" on-hand. You are attempting to sell/dispatch ${requiredQty} Pcs.`);
        return;
      }
    }

    try {
      const finalDispatchNum = customDispatchNumber.trim() || generateNextUniqueSeries('DSP', outwards.map(o => o.dispatchNumber), 1001);

      // Validate uniqueness
      if (!isSeriesUnique(finalDispatchNum, outwards.map(o => o.dispatchNumber))) {
        setFormError(`Series Ref Number "${finalDispatchNum}" already exists! Dispatch reference numbers must be strictly unique.`);
        return;
      }

      // Sequentially save each dispatch outward entry (one per product line)
      for (const item of items) {
        const selectedProd = products.find(p => p.itemCode === item.itemCode)!;
        const numQty = typeof item.qty === 'number' ? item.qty : (parseFloat(item.qty) || 0);
        await onAddOutward({
          dispatchNumber: finalDispatchNum,
          date,
          customerId,
          customerName: selectedCust.name,
          warehouseId,
          warehouseName: selectedWh.name,
          itemCode: item.itemCode,
          itemName: selectedProd.name,
          qty: numQty,
          vehicleNumber: vehicleNumber.trim() || 'N/A',
          driverName: driverName.trim() || 'N/A',
          transportName: transportName.trim() || 'N/A',
          remarks: remarks.trim() || 'Customer order dispatch.',
          invoiceNumber: invoiceNumber.trim() || 'N/A',
        });
      }

      setFormSuccess(`Dispatch order ${finalDispatchNum} successfully created with ${items.length} item(s), stock deducted, and ledger updated!`);
      setIsFormOpen(false);
    } catch (err) {
      console.error(err);
      setFormError('Failed to record dispatch transaction. Ensure cloud database connection is healthy.');
    }
  };

  const handleDeleteGroupedDispatch = async (dispatchNumber: string, itemsList: Array<{ id?: string }>) => {
    if (!isAuthorized) {
      alert('Access Denied: You are not authorized to delete customer dispatch orders.');
      return;
    }

    if (window.confirm(`Are you sure you want to permanently delete Dispatch Order "${dispatchNumber}" and reverse all of its ${itemsList.length} item line records back into warehouse stock?\n\nNote: Posted document numbering is permanent for audit compliance.`)) {
      try {
        if (onDeleteOutwardGroup) {
          await onDeleteOutwardGroup(dispatchNumber);
        } else {
          for (const item of itemsList) {
            if (item.id) {
              await onDeleteOutward(item.id);
            }
          }
        }
        setFormSuccess(`Dispatch Order ${dispatchNumber} was successfully deleted and inventory was restored.`);
        if (isEditModalOpen) {
          setIsEditModalOpen(false);
          setEditingDispatch(null);
        }
      } catch (err: any) {
        console.error('Error deleting dispatch order:', err);
        alert(`Failed to delete dispatch order: ${err?.message || err}`);
      }
    }
  };

  // Search filter across dispatch order fields and item lines
  const filteredGroupedDispatches = useMemo(() => {
    const query = searchQuery.toLowerCase();
    if (!query) return groupedDispatches;

    return groupedDispatches.filter((disp) => {
      const matchesHeader = 
        disp.dispatchNumber.toLowerCase().includes(query) ||
        disp.customerName.toLowerCase().includes(query) ||
        disp.warehouseName.toLowerCase().includes(query) ||
        disp.vehicleNumber.toLowerCase().includes(query) ||
        disp.transportName.toLowerCase().includes(query) ||
        (disp.invoiceNumber && disp.invoiceNumber.toLowerCase().includes(query));
      
      const matchesItems = disp.items.some(
        (it) => 
          it.itemCode.toLowerCase().includes(query) || 
          it.itemName.toLowerCase().includes(query)
      );

      return matchesHeader || matchesItems;
    });
  }, [groupedDispatches, searchQuery]);

  return (
    <div id="customer-dispatch-view" className="space-y-6 animate-fade-in font-sans">
      {/* Header and Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-gray-800">Customer Outbound Dispatches</h2>
          <p className="text-[10px] text-gray-500">
            Dispatch materials directly to client accounts. <strong className="text-rose-600 font-extrabold">Notice: Dispatches are strictly restricted to Secondary Warehouses only.</strong>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-400" />
            <input
              type="text"
              placeholder="Search dispatch, client, SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none w-52 shadow-xs"
            />
          </div>

          {isSuperAdmin && onRearrangeSeries && (
            <button
              onClick={async () => {
                try {
                  const res = await onRearrangeSeries();
                  if (!res || res.updatedCount === 0) {
                    alert('Posted customer dispatch orders are permanent and immutable. No draft dispatches were found to renumber.');
                  } else {
                    alert(`Successfully rearranged draft dispatch series! Updated ${res.updatedCount} order series numbers.`);
                  }
                } catch (e: any) {
                  alert(`Failed to rearrange series: ${e.message || e}`);
                }
              }}
              className="bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-all shadow-2xs border border-amber-300"
              title="Auto Rearrange Draft Dispatch Series sequentially"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
              <span>Auto Rearrange Series</span>
            </button>
          )}

          {isAuthorized && (
            <button
              onClick={openCreateForm}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-all shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Customer Dispatch</span>
            </button>
          )}
        </div>
      </div>

      {/* Corporate Rule Warning Panel */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-amber-900 shadow-2xs">
        <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs">
          <span className="font-extrabold block">Distribution Policy & Logistics Matrix Enforced</span>
          <p className="mt-1 text-amber-800 font-medium">
            Standard Operating Procedures dictate that our **Central Primary Warehouse** operates strictly as a bulk import and supply hub. Customer orders are dispatched **only from Regional Secondary Warehouses** to ensure localized fulfillment, tax compliance, and faster regional shipping.
          </p>
        </div>
      </div>

      {/* Mobile Swipeable Dispatch List */}
      <div className="block md:hidden space-y-4">
        {filteredGroupedDispatches.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-xs">
            <Info className="w-5 h-5 mx-auto mb-2 text-gray-300" />
            <span>No customer dispatch records found matching filters.</span>
          </div>
        ) : (
          filteredGroupedDispatches.map((disp) => {
            const totalQty = disp.items.reduce((sum, item) => sum + item.qty, 0);
            return (
              <Swipeable
                key={disp.dispatchNumber}
                onSwipeLeft={isAuthorized ? () => handleDeleteGroupedDispatch(disp.dispatchNumber, disp.items) : undefined}
                rightLabel="Delete"
                rightBgColor="bg-rose-600"
              >
                <div className="bg-white rounded-xl border border-gray-150 p-4 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-50 pb-2">
                    <div className="flex items-center gap-1.5 font-mono font-bold text-indigo-700 text-xs">
                      <Truck className="w-3.5 h-3.5 text-indigo-500" />
                      <span>{disp.dispatchNumber}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono">{disp.date}</span>
                  </div>

                  {/* Customer and warehouse badge */}
                  <div>
                    <div className="font-bold text-gray-900 text-sm flex items-center justify-between">
                      <span>{disp.customerName}</span>
                      <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        {disp.warehouseName}
                      </span>
                    </div>
                    {disp.invoiceNumber && disp.invoiceNumber !== 'N/A' && (
                      <span className="inline-block mt-1 text-[10px] font-mono font-bold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                        Inv No: {disp.invoiceNumber}
                      </span>
                    )}
                  </div>

                  {/* Line items list */}
                  <div className="bg-slate-50/70 p-2.5 rounded-lg border border-slate-100 space-y-1.5">
                    <span className="text-[9px] font-extrabold uppercase text-slate-400 tracking-wider block">
                      Dispatched Items ({disp.items.length})
                    </span>
                    <div className="space-y-1">
                      {disp.items.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs font-mono">
                          <span className="text-gray-700 truncate max-w-[180px]">{item.itemName}</span>
                          <span className="text-rose-600 font-bold bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded text-[10px]">
                            -{item.qty} Pcs
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Carrier details */}
                  <div className="text-[10px] text-gray-500 pt-2 border-t border-slate-50">
                    <span className="font-semibold text-gray-800 block">Carrier: {disp.transportName}</span>
                    <span className="text-[9px] text-gray-400 font-mono block">Vehicle: {disp.vehicleNumber} | Driver: {disp.driverName}</span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                    {isAuthorized && onEditOutward && (
                      <button
                        onClick={() => openEditModal(disp)}
                        className="px-2.5 py-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md border border-indigo-200 flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                      >
                        <Pencil className="w-3 h-3 text-indigo-600" /> Edit Voucher
                      </button>
                    )}
                    {isAuthorized && (
                      <button
                        onClick={() => handleDeleteGroupedDispatch(disp.dispatchNumber, disp.items)}
                        className="px-2.5 py-1 text-[10px] font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md border border-rose-200 flex items-center gap-1 cursor-pointer transition-colors ml-auto shadow-2xs"
                        title="Delete entire dispatch voucher"
                      >
                        <Trash2 className="w-3 h-3 text-rose-600" /> Delete Dispatch
                      </button>
                    )}
                  </div>
                </div>
              </Swipeable>
            );
          })
        )}
      </div>

      {/* Directory Table (Desktop-Only) */}
      <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/75 border-b border-gray-200 text-gray-400 uppercase font-mono text-[9px] tracking-wider">
                <th className="px-6 py-3.5 font-bold">Dispatch Order No</th>
                <th className="px-6 py-3.5 font-bold">Date</th>
                <th className="px-6 py-3.5 font-bold">Customer Client</th>
                <th className="px-6 py-3.5 font-bold">Fulfillment Source (Secondary)</th>
                <th className="px-6 py-3.5 font-bold">Line Items (SKU / Product / Qty)</th>
                <th className="px-6 py-3.5 font-bold">Total Qty</th>
                <th className="px-6 py-3.5 font-bold">Carrier & Vehicle</th>
                <th className="px-6 py-3.5 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs text-gray-600 font-medium">
              {filteredGroupedDispatches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">
                    <Info className="w-5 h-5 mx-auto mb-2 text-gray-300" />
                    <span>No customer dispatch records found matching filters.</span>
                  </td>
                </tr>
              ) : (
                filteredGroupedDispatches.map((disp) => {
                  const totalQty = disp.items.reduce((sum, item) => sum + item.qty, 0);
                  return (
                    <tr key={disp.dispatchNumber} className="hover:bg-slate-50/50 transition-colors align-top">
                      <td className="px-6 py-4 font-mono font-bold text-indigo-700">
                        <div className="flex items-center gap-1.5 pt-1">
                          <Truck className="w-3.5 h-3.5 text-indigo-500" />
                          <span>{disp.dispatchNumber}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-gray-500 pt-5">{disp.date}</td>
                      <td className="px-6 py-4 pt-4">
                        <span className="font-bold text-gray-900 block">{disp.customerName}</span>
                        {disp.invoiceNumber && disp.invoiceNumber !== 'N/A' && (
                          <span className="inline-block mt-1 mb-1 text-[10px] font-mono font-bold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                            Inv No: {disp.invoiceNumber}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 block font-mono">ID: {disp.customerId?.substring(0, 8)}...</span>
                      </td>
                      <td className="px-6 py-4 pt-4">
                        <span className="font-semibold text-gray-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {disp.warehouseName}
                        </span>
                      </td>
                      <td className="px-6 py-4 max-w-xs pt-4">
                        <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          {disp.items.map((it, idx) => (
                            <div key={idx} className="flex items-center justify-between text-[11px] border-b border-dashed border-slate-200 last:border-0 pb-1 last:pb-0 pt-1 first:pt-0 gap-2">
                              <div className="flex flex-col">
                                <span className="font-semibold text-slate-800 leading-tight">{it.itemName}</span>
                                <span className="text-[9px] text-gray-400 font-mono">{it.itemCode}</span>
                              </div>
                              <span className="font-mono text-rose-600 font-black shrink-0 bg-rose-50/50 border border-rose-100/30 px-1.5 py-0.5 rounded text-xs">
                                -{it.qty}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-black text-rose-600 font-mono text-sm pt-5">
                        -{totalQty}
                      </td>
                      <td className="px-6 py-4 text-gray-500 max-w-xs pt-4">
                        <div className="text-[11px] font-semibold text-gray-800">Carrier: {disp.transportName}</div>
                        <div className="text-[10px] text-gray-400 font-mono">Vehicle: {disp.vehicleNumber} | Driver: {disp.driverName}</div>
                      </td>
                      <td className="px-6 py-4 text-right pt-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {isAuthorized && onEditOutward && (
                            <button
                              onClick={() => openEditModal(disp)}
                              className="px-2.5 py-1 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 font-bold text-xs shadow-2xs"
                              title="Edit Customer Dispatch Voucher"
                            >
                              <Pencil className="w-3 h-3 text-indigo-600" />
                              <span>Edit Voucher</span>
                            </button>
                          )}
                          {isAuthorized && (
                            <button
                              onClick={() => handleDeleteGroupedDispatch(disp.dispatchNumber, disp.items)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer inline-flex items-center"
                              title="Delete dispatch group and restore stock"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dispatch Creation Slide-over/Modal */}
      <AnimatePresence>
        {isFormOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 25 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 25 }}
              transition={{ type: 'spring', damping: 25, stiffness: 320 }}
              className="relative w-full max-w-2xl max-h-[calc(100vh-4rem)] bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="bg-slate-950 text-white px-6 py-4 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-indigo-400">
                    New Multi-Item Customer Dispatch
                  </h3>
                  <p className="text-[10px] text-gray-400 mt-0.5">Authorizes outward bulk/multiple stock movements from regional fulfillment centers</p>
                </div>
                <button
                  onClick={() => setIsFormOpen(false)}
                  className="text-gray-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

            {/* Error alerts */}
            {formError && (
              <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-[11px] rounded-lg font-bold flex gap-2 shrink-0">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleCreateDispatch} className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Dispatch Series Number & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                    Dispatch Series Ref No. (Must be unique) *
                  </label>
                  <input
                    type="text"
                    required
                    value={customDispatchNumber}
                    onChange={(e) => setCustomDispatchNumber(e.target.value)}
                    placeholder="e.g. DSP-1001"
                    className="w-full bg-slate-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs font-mono font-bold text-indigo-700 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                  <p className="text-[9px] text-gray-400">★ Auto-generated unique gapless series number</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Dispatch Date</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-800 font-semibold"
                  />
                </div>
              </div>

              {/* Warehouse Selection */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Fulfillment Source Warehouse *</label>
                <select
                  required
                  disabled={shouldRestrictWarehouse}
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className="w-full bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-800 font-semibold disabled:opacity-80 disabled:bg-gray-100"
                >
                  {shouldRestrictWarehouse ? (
                    warehouses.filter(w => w.code === currentWarehouseId).map((w, idx) => (
                      <option key={`${w.id || w.code}-${idx}`} value={w.code}>
                        {w.name} {w.isPrimary ? '(Primary)' : '(Secondary)'}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="">-- Select Secondary Warehouse --</option>
                      {secondaryWarehouses.map((w, idx) => (
                        <option key={`${w.id || w.code}-${idx}`} value={w.code}>
                          {w.name} (Secondary)
                        </option>
                      ))}
                      {primaryWh && (
                        <option value={primaryWh.code} disabled className="text-gray-300">
                          {primaryWh.name} (Primary - BLOCKED FOR CUSTOMER DISPATCH)
                        </option>
                      )}
                    </>
                  )}
                </select>
                <p className="text-[9px] text-amber-600 font-bold">★ Restrained: Only regional secondary facilities can dispatch to customers.</p>
              </div>

              {/* Customer Client & Invoice No */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Recipient Customer Client *</label>
                  <select
                    required
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="w-full bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-800 font-semibold"
                  >
                    <option value="">-- Select Customer Profile --</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name} {c.gstNumber ? `(${c.gstNumber})` : ''}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Invoice Number (Optional)</label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="e.g. INV-2026-045"
                    className="w-full bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-850 font-semibold"
                  />
                </div>
              </div>

              {/* Dynamic Multiple Item Rows */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Dispatch Line Items</span>
                  <button
                    type="button"
                    onClick={addItemRow}
                    className="text-xs bg-indigo-550 hover:bg-indigo-600 text-indigo-700 font-extrabold flex items-center gap-1 hover:underline"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Item Row</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {items.map((row, idx) => {
                    const st = stocks.find(s => s.itemCode === row.itemCode && s.warehouseId === warehouseId);
                    const available = st ? getLiveAvailableQty(st, warehouses) : 0;
                    return (
                      <div key={idx} className="flex items-end gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <div className="flex-1 space-y-1">
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Select Product SKU</label>
                          <select
                            required
                            value={row.itemCode}
                            onChange={(e) => updateItemRow(idx, 'itemCode', e.target.value)}
                            className="w-full bg-white border border-gray-250 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-semibold text-gray-800"
                          >
                            <option value="">-- Select Product SKU --</option>
                            {products.map(p => (
                              <option key={p.itemCode} value={p.itemCode}>
                                {p.name} [{p.itemCode}]
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="w-32 space-y-1">
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                            <span>Qty</span>
                            {Number(row.qty) > available && (
                              <span className="text-[8px] text-rose-600 font-extrabold animate-pulse">Exceeds Stock!</span>
                            )}
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            required
                            value={row.qty}
                            onChange={(e) => updateItemRow(idx, 'qty', e.target.value)}
                            className={`w-full bg-white border rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:outline-none font-bold text-gray-850 ${
                              Number(row.qty) > available
                                ? 'border-rose-400 focus:ring-rose-500 bg-rose-50/50 text-rose-800'
                                : 'border-gray-250 focus:ring-indigo-500 text-gray-800'
                            }`}
                            placeholder="Qty (numbers only)"
                          />
                        </div>

                        <div className="text-right text-[10px] font-mono text-gray-500 pb-2 flex-col justify-end">
                          <div className="text-slate-400">Warehouse stock:</div>
                          <div className={`font-extrabold ${available === 0 ? 'text-rose-600' : row.qty > available ? 'text-amber-650 font-black' : 'text-slate-800'}`}>{available} Pcs</div>
                        </div>

                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItemRow(idx)}
                            className="p-2 text-slate-400 hover:text-rose-600 rounded-lg bg-white border border-gray-200 hover:bg-rose-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Logistics & Transit Details */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <h4 className="text-[10px] font-black uppercase text-indigo-700 tracking-wider">Logistics & Driver Waybill Details</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Vehicle Number</label>
                    <input
                      type="text"
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value)}
                      placeholder="e.g. MH-02-CD-5678"
                      className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Driver Name</label>
                    <input
                      type="text"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      placeholder="e.g. Ramesh Patil"
                      className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Carrier Transport</label>
                    <input
                      type="text"
                      value={transportName}
                      onChange={(e) => setTransportName(e.target.value)}
                      placeholder="e.g. BlueDart Cargo"
                      className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800"
                    />
                  </div>
                </div>
              </div>

              {/* Remarks */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Waybill Remarks & Memo</label>
                <textarea
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Log any client purchase order numbers or transit instructions here"
                  className="w-full bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800 resize-none"
                />
              </div>

              <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-4 py-2 rounded-lg text-xs cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 py-2 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-all shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Release & Dispatch</span>
                </button>
              </div>
            </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Dispatch Voucher Modal */}
      <AnimatePresence>
        {isEditModalOpen && editingDispatch && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 25 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 25 }}
              transition={{ type: 'spring', damping: 25, stiffness: 320 }}
              className="relative w-full max-w-2xl max-h-[calc(100vh-4rem)] bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="bg-slate-950 text-white px-6 py-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Pencil className="w-4 h-4 text-indigo-400" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-black uppercase tracking-wider text-white">
                        Edit Customer Dispatch Voucher
                      </h3>
                      <span className="bg-indigo-900/80 text-indigo-300 font-mono font-bold text-[10px] px-2 py-0.5 rounded border border-indigo-700">
                        {editingDispatch.dispatchNumber}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Update recipient client, transport, carrier, and invoice details for this dispatch voucher
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="text-gray-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Error alerts */}
              {editError && (
                <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-[11px] rounded-lg font-bold flex gap-2 shrink-0">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              {/* Edit Form */}
              <form onSubmit={handleSaveEditVoucher} className="p-6 space-y-4 overflow-y-auto flex-1">
                {/* Dispatch Series Number (Locked) & Date */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block flex items-center gap-1">
                      <Lock className="w-3 h-3 text-slate-400" /> Dispatch Series Number (Permanent)
                    </label>
                    <div className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono font-bold text-slate-700 flex items-center justify-between">
                      <span>{editingDispatch.dispatchNumber}</span>
                      <span className="text-[9px] font-sans font-semibold text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded">Locked</span>
                    </div>
                    <p className="text-[9px] text-slate-400">★ Posted document numbering is permanently immutable under Change #11.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Dispatch Date *</label>
                    <input
                      type="date"
                      required
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-800 font-semibold"
                    />
                  </div>
                </div>

                {/* Warehouse (Read-only) & Customer Client */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Fulfillment Source Facility</label>
                    <div className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700">
                      {editingDispatch.warehouseName}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Recipient Customer Client *</label>
                    <select
                      required
                      value={editCustomerId}
                      onChange={(e) => setEditCustomerId(e.target.value)}
                      className="w-full bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-800 font-semibold"
                    >
                      <option value="">-- Select Customer Profile --</option>
                      {customers.map(c => (
                        <option key={c.id} value={c.id}>{c.name} {c.gstNumber ? `(${c.gstNumber})` : ''}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Invoice Number & Carrier Details */}
                <div className="space-y-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Logistics & Billing Metadata</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Invoice Number</label>
                      <input
                        type="text"
                        value={editInvoiceNumber}
                        onChange={(e) => setEditInvoiceNumber(e.target.value)}
                        placeholder="e.g. INV-2026-045"
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Vehicle / Transport Reg No.</label>
                      <input
                        type="text"
                        value={editVehicleNumber}
                        onChange={(e) => setEditVehicleNumber(e.target.value)}
                        placeholder="e.g. MH-12-AB-1234"
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Driver Name & Contact</label>
                      <input
                        type="text"
                        value={editDriverName}
                        onChange={(e) => setEditDriverName(e.target.value)}
                        placeholder="e.g. Ramesh Patil"
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Carrier / Transporter Name</label>
                      <input
                        type="text"
                        value={editTransportName}
                        onChange={(e) => setEditTransportName(e.target.value)}
                        placeholder="e.g. BlueDart Cargo"
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800"
                      />
                    </div>
                  </div>
                </div>

                {/* Editable Line Items Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                      Dispatched Products & Line Items ({editItems.length}) *
                    </label>
                    <button
                      type="button"
                      onClick={addEditItemRow}
                      className="text-xs text-indigo-600 hover:text-indigo-700 font-bold flex items-center gap-1 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded cursor-pointer transition-colors shadow-2xs"
                    >
                      <Plus className="w-3 h-3" /> Add Item
                    </button>
                  </div>

                  <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                    {editItems.map((row, idx) => {
                      const sourceStock = stocks.find(s => s.itemCode === row.itemCode && s.warehouseId === editingDispatch.warehouseId);
                      const currentAvailable = sourceStock ? getLiveAvailableQty(sourceStock, warehouses) : 0;
                      const origItem = editingDispatch.items.find(i => i.itemCode === row.itemCode);
                      const origQty = origItem ? origItem.qty : 0;
                      const totalAvailable = currentAvailable + origQty;

                      return (
                        <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-end gap-3">
                          <div className="flex-1 space-y-1">
                            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">
                              Product SKU / Name #{idx + 1}
                            </label>
                            <select
                              required
                              value={row.itemCode}
                              onChange={(e) => updateEditItemRow(idx, 'itemCode', e.target.value)}
                              className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-semibold text-gray-800"
                            >
                              <option value="">-- Select Product --</option>
                              {products.map(p => (
                                <option key={p.itemCode} value={p.itemCode}>
                                  {p.name} ({p.itemCode})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="w-28 space-y-1">
                            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                              <span>Qty</span>
                              {Number(row.qty) > totalAvailable && (
                                <span className="text-[8px] text-rose-600 font-extrabold animate-pulse">Exceeds!</span>
                              )}
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              required
                              value={row.qty}
                              onChange={(e) => updateEditItemRow(idx, 'qty', e.target.value)}
                              className={`w-full bg-white border rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:outline-none font-bold ${
                                Number(row.qty) > totalAvailable
                                  ? 'border-rose-400 focus:ring-rose-500 bg-rose-50/50 text-rose-800'
                                  : 'border-gray-200 focus:ring-indigo-500 text-gray-800'
                              }`}
                              placeholder="Qty"
                            />
                          </div>

                          <div className="text-right text-[10px] font-mono text-gray-500 pb-1 flex-col justify-end min-w-[90px]">
                            <div className="text-slate-400 text-[9px]">Avail + Voucher:</div>
                            <div className={`font-extrabold ${totalAvailable === 0 ? 'text-rose-600' : Number(row.qty) > totalAvailable ? 'text-amber-600 font-black' : 'text-slate-800'}`}>
                              {totalAvailable} Pcs
                            </div>
                          </div>

                          {editItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeEditItemRow(idx)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer self-center sm:self-end mb-0.5"
                              title="Remove item row"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Remarks */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Waybill Remarks & Memo</label>
                  <textarea
                    rows={2}
                    value={editRemarks}
                    onChange={(e) => setEditRemarks(e.target.value)}
                    placeholder="Log any client purchase order numbers or transit instructions here"
                    className="w-full bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800 resize-none"
                  />
                </div>

                <div className="pt-4 border-t border-gray-100 flex items-center justify-between gap-2">
                  {isAuthorized ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteGroupedDispatch(editingDispatch.dispatchNumber, editingDispatch.items)}
                      className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold px-3.5 py-2 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                      title="Permanently delete this dispatch voucher and restore inventory"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      <span>Delete Voucher</span>
                    </button>
                  ) : <div />}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditModalOpen(false)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-4 py-2 rounded-lg text-xs cursor-pointer transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingEdit}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-all shadow-xs"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{isSubmittingEdit ? 'Saving...' : 'Save Voucher Changes'}</span>
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
