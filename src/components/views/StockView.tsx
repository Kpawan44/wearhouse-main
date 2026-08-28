import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layers, Warehouse, AlertTriangle, Search, Filter, ShieldCheck, Download, Lock } from 'lucide-react';
import { Stock, Product, Warehouse as WHType, isDerabassi, isPrimaryWarehouse, getLiveAvailableQty } from '../../types';

interface StockViewProps {
  stocks: Stock[];
  products: Product[];
  warehouses: WHType[];
  currentWarehouseId?: string;
  currentUserRole?: string;
}

export const StockView: React.FC<StockViewProps> = ({ stocks, products, warehouses, currentWarehouseId, currentUserRole }) => {
  const activeWh = warehouses.find(w => w.code === currentWarehouseId);
  const isPune = activeWh 
    ? (activeWh.name.toLowerCase().includes('pune') || activeWh.city?.toLowerCase().includes('pune') || activeWh.code.toLowerCase().includes('pun'))
    : (currentWarehouseId?.toLowerCase().includes('pun') || false);

  const isSuperAdmin = currentUserRole === 'Super Admin';
  const shouldRestrictWarehouse = !isSuperAdmin && !!currentWarehouseId;

  const [selectedWarehouse, setSelectedWarehouse] = useState(
    shouldRestrictWarehouse ? (currentWarehouseId || '') : (isPune ? (currentWarehouseId || 'WH-PUN') : 'All')
  );
  const [selectedStockLevel, setSelectedStockLevel] = useState<'all' | 'low' | 'out' | 'healthy'>('all');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const categories = React.useMemo(() => {
    const cats = products.map(p => p.category).filter(Boolean);
    return ['All', ...Array.from(new Set(cats))];
  }, [products]);

  // Keep state in sync if isPune changes, currentWarehouseId changes or restrictions change
  useEffect(() => {
    if (shouldRestrictWarehouse) {
      setSelectedWarehouse(currentWarehouseId || '');
    } else if (isPune) {
      setSelectedWarehouse(currentWarehouseId || 'WH-PUN');
    }
  }, [shouldRestrictWarehouse, isPune, currentWarehouseId]);

  // Filtering logic
  const filteredStocks = stocks.filter(s => {
    const prod = products.find(p => p.itemCode === s.itemCode);
    if (!prod) return false;

    // Strict warehouse restriction if non-SuperAdmin is assigned to a warehouse
    const matchesWh = shouldRestrictWarehouse
      ? s.warehouseId === currentWarehouseId
      : (selectedWarehouse === 'All' || s.warehouseId === selectedWarehouse);

    const matchesSearch = s.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.barcode.includes(searchQuery);

    let matchesStockLevel = true;
    const isDera = isDerabassi(s.warehouseName, s.warehouseId);
    const liveAvailable = getLiveAvailableQty(s, warehouses);
    if (selectedStockLevel === 'low') {
      matchesStockLevel = !isDera && liveAvailable > 0 && liveAvailable <= prod.minStock;
    } else if (selectedStockLevel === 'out') {
      matchesStockLevel = !isDera && liveAvailable === 0;
    } else if (selectedStockLevel === 'healthy') {
      matchesStockLevel = isDera || liveAvailable > prod.minStock;
    }

    const matchesCategory = selectedCategory === 'All' || prod.category === selectedCategory;

    return matchesWh && matchesSearch && matchesStockLevel && matchesCategory;
  });

  const getStockStatus = (stock: Stock, minStock: number) => {
    if (isDerabassi(stock.warehouseName, stock.warehouseId)) {
      return <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-indigo-100 text-indigo-800 uppercase">Infinite Stock</span>;
    }
    const liveAvailable = getLiveAvailableQty(stock, warehouses);
    if (liveAvailable === 0) {
      // Check if stock exists in other warehouses for this SKU
      const otherStocks = stocks.filter(st => st.itemCode === stock.itemCode && st.warehouseId !== stock.warehouseId && !isDerabassi(st.warehouseName, st.warehouseId));
      const availInOthers = otherStocks.filter(st => getLiveAvailableQty(st, warehouses) > 0);
      if (availInOthers.length > 0) {
        const totalOtherQty = availInOthers.reduce((sum, st) => sum + getLiveAvailableQty(st, warehouses), 0);
        const locations = availInOthers.map(st => `${st.warehouseName}: ${getLiveAvailableQty(st, warehouses)}`).join(', ');
        return (
          <div className="flex flex-col items-end gap-0.5">
            <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-100 text-amber-900 uppercase">Out of Stock Locally</span>
            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100/80" title={locations}>
              {totalOtherQty} Pcs in other hubs
            </span>
          </div>
        );
      }
      return <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-red-100 text-red-800 uppercase">Out of Stock</span>;
    } else if (liveAvailable <= minStock) {
      return <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-100 text-amber-800 uppercase">Low Stock</span>;
    } else {
      return <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-100 text-emerald-800 uppercase">Healthy</span>;
    }
  };

  const lowStockCount = React.useMemo(() => {
    if (selectedWarehouse === 'All') {
      return products.filter(p => {
        const pStocks = stocks.filter(s => s.itemCode === p.itemCode && !isDerabassi(s.warehouseName, s.warehouseId));
        const tot = pStocks.reduce((sum, s) => sum + getLiveAvailableQty(s, warehouses), 0);
        return tot > 0 && tot <= p.minStock;
      }).length;
    } else {
      return filteredStocks.filter(s => {
        if (isDerabassi(s.warehouseName, s.warehouseId)) return false;
        const prod = products.find(p => p.itemCode === s.itemCode);
        const live = getLiveAvailableQty(s, warehouses);
        return prod ? live > 0 && live <= prod.minStock : false;
      }).length;
    }
  }, [selectedWarehouse, filteredStocks, products, stocks, warehouses]);

  const outOfStockCount = React.useMemo(() => {
    if (selectedWarehouse === 'All') {
      return products.filter(p => {
        const pStocks = stocks.filter(s => s.itemCode === p.itemCode && !isDerabassi(s.warehouseName, s.warehouseId));
        const tot = pStocks.reduce((sum, s) => sum + getLiveAvailableQty(s, warehouses), 0);
        return tot === 0;
      }).length;
    } else {
      return filteredStocks.filter(s => {
        if (isDerabassi(s.warehouseName, s.warehouseId)) return false;
        return getLiveAvailableQty(s, warehouses) === 0;
      }).length;
    }
  }, [selectedWarehouse, filteredStocks, products, stocks, warehouses]);

  // CSV Export Simulation
  const handleExportCSV = () => {
    const headers = ['Item Code', 'Item Name', 'Warehouse', 'Available Qty (Live)', 'Reserved Qty', 'In Transit Qty', 'Damaged Qty', 'Total Qty', 'Safety Status'];
    const rows = filteredStocks.map(s => {
      const prod = products.find(p => p.itemCode === s.itemCode);
      const isDera = isDerabassi(s.warehouseName, s.warehouseId);
      const liveAvailable = getLiveAvailableQty(s, warehouses);
      const status = isDera ? 'Infinite Stock' : (liveAvailable === 0 ? 'Out of Stock' : (prod && liveAvailable <= prod.minStock ? 'Low Stock' : 'Healthy'));
      return [
        s.itemCode,
        s.itemName,
        s.warehouseName,
        isDera ? 'Infinite' : liveAvailable,
        s.reservedQty,
        s.inTransitQty,
        s.damagedQty,
        isDera ? 'Infinite' : s.totalQty,
        status
      ];
    });

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Stock_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="stock-view" className="space-y-6 animate-fade-in">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-gray-800">Live Inventory stock ledger</h2>
          <p className="text-[10px] text-gray-500">Real-time counts of available, reserved, damaged, and in-transit screw stock in Pcs across all warehouses</p>
        </div>

        {/* Touch-optimized, fully responsive filters layout */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:items-center gap-3 w-full lg:w-auto">
          {/* Warehouse filter */}
          {shouldRestrictWarehouse || isPune ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 md:px-2.5 md:py-1.5 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs h-11 md:h-auto">
              <Lock className="w-4 h-4 md:w-3 md:h-3 text-amber-600 animate-pulse" />
              <span>{activeWh?.name || currentWarehouseId}</span>
            </div>
          ) : (
            <select
              value={selectedWarehouse}
              onChange={(e) => setSelectedWarehouse(e.target.value)}
              className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 md:px-2.5 md:py-1.5 text-sm md:text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-xs h-11 md:h-auto w-full md:w-auto cursor-pointer"
            >
              <option value="All">All Warehouses</option>
              {warehouses.map((wh, idx) => (
                <option key={`${wh.id || wh.code}-${idx}`} value={wh.code}>{wh.name}</option>
              ))}
            </select>
          )}

          {/* Level Filter */}
          <select
            value={selectedStockLevel}
            onChange={(e) => setSelectedStockLevel(e.target.value as any)}
            className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 md:px-2.5 md:py-1.5 text-sm md:text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-xs h-11 md:h-auto w-full md:w-auto cursor-pointer"
          >
            <option value="all">All Levels</option>
            <option value="healthy">Healthy Levels Only</option>
            <option value="low">Low Safety Stock</option>
            <option value="out">Out of Stock Only</option>
          </select>

          {/* Customer Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 md:px-2.5 md:py-1.5 text-sm md:text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-xs h-11 md:h-auto w-full md:w-auto cursor-pointer"
          >
            <option value="All">All Customers</option>
            {categories.filter(c => c !== 'All').map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          {/* Search SKU or Name */}
          <div className="relative w-full lg:w-48 h-11 md:h-auto">
            <span className="absolute inset-y-0 left-3 flex items-center text-gray-400">
              <Search className="w-4 h-4" />
            </span>
            <input
              type="text"
              placeholder="Search SKU or Name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 md:py-1.5 text-sm md:text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none w-full shadow-xs h-11 md:h-auto"
            />
          </div>

          {/* Export CSV Button */}
          <button
            onClick={handleExportCSV}
            className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-4 py-2.5 md:px-3 md:py-1.5 rounded-xl md:rounded-lg text-sm md:text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-xs h-11 md:h-auto w-full md:w-auto"
          >
            <Download className="w-4 h-4 md:w-3.5 md:h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Grid Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-100 flex items-center gap-3 shadow-xs">
          <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-400 block uppercase font-bold">Total Physical Stock</span>
            <strong className="text-sm font-extrabold text-gray-800">
              {filteredStocks.reduce((sum, s) => sum + s.totalQty, 0).toLocaleString()} Pcs
            </strong>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-100 flex items-center gap-3 shadow-xs">
          <div className="p-2 bg-amber-50 text-amber-700 rounded-lg">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-400 block uppercase font-bold">Low stock alerts</span>
            <strong className="text-sm font-extrabold text-amber-700">
              {lowStockCount} items triggered
            </strong>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-100 flex items-center gap-3 shadow-xs">
          <div className="p-2 bg-red-50 text-rose-700 rounded-lg">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-400 block uppercase font-bold">out of stock</span>
            <strong className="text-sm font-extrabold text-rose-700">
              {outOfStockCount} items empty
            </strong>
          </div>
        </div>
      </div>

      {/* MOBILE LIST OF STOCK CARDS (Touch target optimized, responsive) */}
      <div className="block md:hidden space-y-4">
        {filteredStocks.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-8 text-center text-gray-400 text-xs">
            No warehouse inventory listings matching active filters.
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filteredStocks.map((s) => {
              const prod = products.find(p => p.itemCode === s.itemCode);
              const minStock = prod ? prod.minStock : 10;
              const unit = prod ? prod.unit : 'Pcs';

              return (
                <motion.div
                  key={s.id || s.itemCode}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  whileTap={{ scale: 0.985 }}
                  className="bg-white border border-slate-150 rounded-2xl p-4 shadow-xs hover:shadow-md transition-shadow relative overflow-hidden"
                >
                  {/* Header info */}
                  <div className="flex items-start justify-between gap-2.5 border-b border-slate-50 pb-3 mb-3">
                    <div className="flex items-center gap-3">
                      {prod && prod.image ? (
                        <img
                          referrerPolicy="no-referrer"
                          src={prod.image}
                          alt={s.itemName}
                          className="w-12 h-12 rounded-xl object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0">
                          {s.itemCode.slice(-3)}
                        </div>
                      )}
                      <div>
                        <h4 className="font-bold text-slate-950 text-xs leading-tight">{s.itemName}</h4>
                        <p className="text-[9px] font-mono text-slate-400 mt-1">SKU: {s.itemCode}</p>
                        {prod?.category && (
                          <p className="text-[9px] text-indigo-600 font-bold mt-0.5">
                            Cust: {prod.category}
                          </p>
                        )}
                      </div>
                    </div>
                    <div>
                      {getStockStatus(s, minStock)}
                    </div>
                  </div>

                  {/* Warehouse Name and total on hand */}
                  <div className="flex justify-between items-center text-[10px] mb-3">
                    <div className="flex items-center gap-1.5 text-slate-600 font-medium">
                      <Warehouse className="w-3.5 h-3.5 text-slate-400" />
                      <span>{s.warehouseName}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-400 block text-[9px] uppercase font-semibold">Total On-Hand</span>
                      <span className="text-slate-950 font-mono font-bold text-xs">
                        {isDerabassi(s.warehouseName, s.warehouseId) ? '∞ (Infinite)' : `${s.totalQty} ${unit}`}
                      </span>
                    </div>
                  </div>

                  {/* Sub-counters touch display block */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="bg-slate-50 rounded-xl p-2 border border-slate-100">
                      <span className="text-[8px] text-slate-400 block font-semibold mb-0.5">Available</span>
                      {(() => {
                        const isDera = isDerabassi(s.warehouseName, s.warehouseId);
                        const isPrimary = isPrimaryWarehouse(s.warehouseId, s.warehouseName, warehouses);
                        const liveAvailable = getLiveAvailableQty(s, warehouses);
                        if (isDera) return <span className="text-[11px] font-mono font-bold block text-indigo-600 font-extrabold">∞</span>;
                        return (
                          <div>
                            <span className={`text-[11px] font-mono font-bold block ${liveAvailable === 0 ? 'text-red-500' : 'text-slate-800'}`}>
                              {liveAvailable}
                            </span>
                            {isPrimary && s.inTransitQty > 0 && (
                              <span className="text-[8px] text-sky-600 block font-medium mt-0.5 leading-tight">(Incl. {s.inTransitQty} in-transit)</span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="bg-amber-50/50 rounded-xl p-2 border border-amber-100/40">
                      <span className="text-[8px] text-amber-700/80 block font-semibold mb-0.5">Reserved</span>
                      <span className="text-[11px] font-mono font-bold text-amber-700 block">
                        {s.reservedQty}
                      </span>
                    </div>
                    <div className="bg-sky-50/50 rounded-xl p-2 border border-sky-100/40">
                      <span className="text-[8px] text-sky-700/80 block font-semibold mb-0.5">In Transit</span>
                      <span className="text-[11px] font-mono font-bold text-sky-700 block">
                        {s.inTransitQty}
                      </span>
                    </div>
                    <div className="bg-rose-50/50 rounded-xl p-2 border border-rose-100/40">
                      <span className="text-[8px] text-rose-700/80 block font-semibold mb-0.5">Damaged</span>
                      <span className="text-[11px] font-mono font-bold text-rose-700 block">
                        {s.damagedQty}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* DESKTOP TABLE OF STOCK LEVELS (always hidden on mobile, visible on desktop) */}
      <div className="hidden md:block bg-white border border-gray-100 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                <th className="p-4">Product Details</th>
                <th className="p-4">Warehouse Location</th>
                <th className="p-4 text-center">Available Qty</th>
                <th className="p-4 text-center">Reserved Qty</th>
                <th className="p-4 text-center">In Transit</th>
                <th className="p-4 text-center">Damaged Qty</th>
                <th className="p-4 text-center bg-gray-50/20">Total On-Hand</th>
                <th className="p-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-xs text-gray-700">
              {filteredStocks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-400 text-xs">
                    No warehouse inventory listings matching your active filters.
                  </td>
                </tr>
              ) : (
                <AnimatePresence mode="popLayout">
                  {filteredStocks.map((s) => {
                    const prod = products.find(p => p.itemCode === s.itemCode);
                    const minStock = prod ? prod.minStock : 10;
                    const unit = prod ? prod.unit : 'Pcs';

                    return (
                      <motion.tr
                        key={s.id || s.itemCode}
                        layout
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="hover:bg-indigo-50/10 transition-colors"
                      >
                        {/* Product Details */}
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            {prod && prod.image ? (
                              <img
                                referrerPolicy="no-referrer"
                                src={prod.image}
                                alt={s.itemName}
                                className="w-10 h-10 rounded-md object-cover border border-gray-200"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-md bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-[10px]">
                                {s.itemCode.slice(-3)}
                              </div>
                            )}
                            <div>
                              <div className="font-bold text-gray-900 text-xs">{s.itemName}</div>
                              <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                                SKU: {s.itemCode}
                              </div>
                              {prod?.category && (
                                <div className="text-[10px] text-indigo-600 font-bold mt-0.5">
                                  Cust: {prod.category}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Warehouse Location */}
                        <td className="p-4">
                          <div className="flex items-center gap-1.5 font-medium text-gray-700">
                            <Warehouse className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            {s.warehouseName}
                          </div>
                        </td>

                        {/* Available Qty */}
                        <td className="p-4 text-center">
                          {(() => {
                            const isDera = isDerabassi(s.warehouseName, s.warehouseId);
                            const isPrimary = isPrimaryWarehouse(s.warehouseId, s.warehouseName, warehouses);
                            const liveAvailable = getLiveAvailableQty(s, warehouses);
                            if (isDera) {
                              return (
                                <span className="font-mono font-extrabold text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                  ∞ Infinite
                                </span>
                              );
                            }
                            return (
                              <div>
                                <span className={`font-mono font-bold text-xs ${liveAvailable === 0 ? 'text-red-500 bg-red-50 px-2 py-0.5 rounded' : 'text-slate-800'}`}>
                                  {liveAvailable} <span className="text-[10px] text-gray-400 font-sans font-normal">{unit}</span>
                                </span>
                                {isPrimary && s.inTransitQty > 0 && (
                                  <div className="text-[9px] text-sky-600 font-medium font-sans mt-0.5">
                                    (Incl. {s.inTransitQty} Pcs in-transit)
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </td>

                        {/* Reserved Qty */}
                        <td className="p-4 text-center font-mono text-gray-500">
                          {s.reservedQty > 0 ? (
                            <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-bold">
                              {s.reservedQty}
                            </span>
                          ) : '0'}
                        </td>

                        {/* In Transit */}
                        <td className="p-4 text-center font-mono text-gray-500">
                          {s.inTransitQty > 0 ? (
                            <span className="text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded font-bold animate-pulse">
                              {s.inTransitQty}
                            </span>
                          ) : '0'}
                        </td>

                        {/* Damaged Qty */}
                        <td className="p-4 text-center font-mono">
                          {s.damagedQty > 0 ? (
                            <span className="text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded font-bold">
                              {s.damagedQty}
                            </span>
                          ) : '0'}
                        </td>

                        {/* Total On-Hand */}
                        <td className="p-4 text-center bg-indigo-50/5 font-mono font-bold text-gray-900">
                          {isDerabassi(s.warehouseName, s.warehouseId) ? '∞ Infinite' : s.totalQty}
                        </td>

                        {/* Safety Status */}
                        <td className="p-4 text-right">
                          {getStockStatus(s, minStock)}
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
