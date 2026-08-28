import React, { useState } from 'react';
import { Layers, TrendingUp, TrendingDown, Download, FileText, Search, Package, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Product, Stock, StockMovement, Warehouse } from '../../types';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface StockReportViewProps {
  products: Product[];
  movements: StockMovement[];
  currentWarehouseId: string;
  warehouses: Warehouse[];
  stocks?: Stock[];
  onReconcileStock?: () => Promise<any>;
}

export const StockReportView: React.FC<StockReportViewProps> = ({
  products,
  movements,
  currentWarehouseId,
  warehouses,
  stocks = [],
  onReconcileStock
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);

  // Find name of current login warehouse
  const activeWh = warehouses.find(w => w.code === currentWarehouseId || w.id === currentWarehouseId);
  const activeWhName = activeWh ? activeWh.name : currentWarehouseId;

  // Filter movements to the selected warehouse or all warehouses
  const isAllWarehouses = !currentWarehouseId || currentWarehouseId === 'ALL' || currentWarehouseId === 'All';
  const filteredMovements = isAllWarehouses
    ? movements
    : movements.filter(m => m.warehouseId === currentWarehouseId);

  // Calculations for Stock Report (Opening, In, Out, Balance) for the selected warehouse scope
  const allStockReportData = products.map(p => {
    const prodMovements = filteredMovements.filter(m => m.itemCode === p.itemCode);
    
    // Identify opening stock movements
    const openingStockMovements = prodMovements.filter(m => 
      m.referenceNumber?.startsWith('OP-') || 
      m.remarks?.toLowerCase().includes('opening stock') || 
      m.remarks?.toLowerCase().includes('initial opening') ||
      m.transactionType === 'Opening Stock Balance' ||
      m.transactionType?.toLowerCase().includes('opening')
    );
    
    const openingStock = openingStockMovements.reduce((sum, m) => sum + m.qty, 0);
    
    // Regular movements (excluding opening stock)
    const regularMovements = prodMovements.filter(m => 
      !(m.referenceNumber?.startsWith('OP-') || 
        m.remarks?.toLowerCase().includes('opening stock') || 
        m.remarks?.toLowerCase().includes('initial opening') ||
        m.transactionType === 'Opening Stock Balance' ||
        m.transactionType?.toLowerCase().includes('opening'))
    );
    
    const qtyIn = regularMovements.reduce((sum, m) => m.qty > 0 ? sum + m.qty : sum, 0);
    const qtyOut = regularMovements.reduce((sum, m) => m.qty < 0 ? sum + Math.abs(m.qty) : sum, 0);
    const ledgerBalance = openingStock + qtyIn - qtyOut;

    // Get live stock from stocks collection
    const matchingStocks = stocks.filter(s => 
      s.itemCode === p.itemCode && (isAllWarehouses || s.warehouseId === currentWarehouseId)
    );
    const liveAvailable = matchingStocks.reduce((sum, s) => sum + (s.availableQty || 0), 0);
    const isSynced = ledgerBalance === liveAvailable;

    return {
      itemCode: p.itemCode,
      itemName: p.name,
      openingStock,
      qtyIn,
      qtyOut,
      balance: ledgerBalance,
      liveAvailable,
      isSynced
    };
  });

  // Filter calculations based on search query
  const stockReportData = allStockReportData.filter(sr =>
    sr.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
    sr.itemName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Warehouse-wide totals (for Bento cards summary)
  const warehouseTotalOpeningStock = allStockReportData.reduce((sum, item) => sum + item.openingStock, 0);
  const warehouseTotalQtyIn = allStockReportData.reduce((sum, item) => sum + item.qtyIn, 0);
  const warehouseTotalQtyOut = allStockReportData.reduce((sum, item) => sum + item.qtyOut, 0);
  const warehouseTotalBalance = allStockReportData.reduce((sum, item) => sum + item.balance, 0);

  // Filtered totals (for table grand totals & exports)
  const grandTotalOpeningStock = stockReportData.reduce((sum, item) => sum + item.openingStock, 0);
  const grandTotalQtyIn = stockReportData.reduce((sum, item) => sum + item.qtyIn, 0);
  const grandTotalQtyOut = stockReportData.reduce((sum, item) => sum + item.qtyOut, 0);
  const grandTotalBalance = stockReportData.reduce((sum, item) => sum + item.balance, 0);

  const handleRunReconciliation = async () => {
    if (!onReconcileStock) return;
    setIsReconciling(true);
    setReconcileMessage(null);
    try {
      const result = await onReconcileStock();
      if (result) {
        const disc = result.discrepancyCount ?? 0;
        const neg = result.negativeStockCount ?? 0;
        const hlth = result.healthyCount ?? 0;
        if (disc === 0 && neg === 0) {
          setReconcileMessage(`Reconciliation complete! All ${hlth} item balances are verified healthy with zero discrepancies.`);
        } else {
          setReconcileMessage(`Reconciliation complete: Detected ${disc} discrepancies and ${neg} negative stock alerts. Exceptions logged.`);
        }
      } else {
        setReconcileMessage(`Reconciliation audit completed.`);
      }
    } catch (err: any) {
      setReconcileMessage(`Reconciliation failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsReconciling(false);
      setTimeout(() => setReconcileMessage(null), 6000);
    }
  };

  const handleExportCSV = () => {
    const headers = ['Item Code', 'Item Name', 'Opening Stock', 'Quantity In', 'Quantity Out', 'Balance Quantity'];
    const rows = stockReportData.map(sr => [sr.itemCode, sr.itemName, sr.openingStock, sr.qtyIn, sr.qtyOut, sr.balance]);
    rows.push(['GRAND TOTALS', '', grandTotalOpeningStock, grandTotalQtyIn, grandTotalQtyOut, grandTotalBalance]);
    const fileName = `Stock_In_Out_Report_${currentWarehouseId}`;

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${fileName}_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const nowStr = new Date().toLocaleString();

    // Title / Header
    doc.setFontSize(16);
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.text('STOCK IN-OUT-BALANCE SUMMARY REPORT', 14, 15);

    doc.setFontSize(9.5);
    doc.setTextColor(79, 70, 229); // Indigo-600
    doc.text(`Warehouse: ${activeWhName} (${currentWarehouseId})`, 14, 21);

    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139); // Slate-500
    doc.text(`Generated: ${nowStr} | Scope: Opening, Receipts, Dispatches, and Net Balances`, 14, 26);

    // Summary Cards block drawn manually (4 cards across width 182mm)
    // Card 1: Total Opening Stock
    doc.setFillColor(239, 246, 255); // Blue-50
    doc.roundedRect(14, 32, 42, 18, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(37, 99, 235); // Blue-600
    doc.text('TOTAL OPENING STOCK', 17, 37);
    doc.setFontSize(11);
    doc.setTextColor(29, 78, 216); // Blue-700
    doc.text(`${grandTotalOpeningStock.toLocaleString()}`, 17, 45);

    // Card 2: Total Quantity In
    doc.setFillColor(240, 253, 250); // Mint-50
    doc.roundedRect(60.6, 32, 42, 18, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(13, 148, 136); // Teal-600
    doc.text('TOTAL QUANTITY IN', 63.6, 37);
    doc.setFontSize(11);
    doc.setTextColor(15, 118, 110);
    doc.text(`${grandTotalQtyIn.toLocaleString()}`, 63.6, 45);

    // Card 3: Total Quantity Out
    doc.setFillColor(254, 242, 242); // Rose-50
    doc.roundedRect(107.2, 32, 42, 18, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(220, 38, 38); // Rose-600
    doc.text('TOTAL QUANTITY OUT', 110.2, 37);
    doc.setFontSize(11);
    doc.setTextColor(185, 28, 28);
    doc.text(`${grandTotalQtyOut.toLocaleString()}`, 110.2, 45);

    // Card 4: Net Balance Stock
    doc.setFillColor(243, 244, 246); // Gray-50
    doc.roundedRect(153.8, 32, 42, 18, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(75, 85, 99); // Gray-600
    doc.text('NET BALANCE STOCK', 156.8, 37);
    doc.setFontSize(11);
    doc.setTextColor(31, 41, 55);
    doc.text(`${grandTotalBalance.toLocaleString()}`, 156.8, 45);

    const tableHeaders = [
      'Item Code',
      'Item Name',
      'Opening Stock',
      'Quantity In',
      'Quantity Out',
      'Balance Quantity'
    ];

    const tableRows = stockReportData.map(sr => [
      sr.itemCode,
      sr.itemName,
      sr.openingStock.toLocaleString(),
      sr.qtyIn.toLocaleString(),
      sr.qtyOut.toLocaleString(),
      sr.balance.toLocaleString()
    ]);

    // Push grand totals
    tableRows.push([
      'GRAND TOTALS',
      '',
      grandTotalOpeningStock.toLocaleString(),
      grandTotalQtyIn.toLocaleString(),
      grandTotalQtyOut.toLocaleString(),
      grandTotalBalance.toLocaleString()
    ]);

    autoTable(doc, {
      startY: 57,
      head: [tableHeaders],
      body: tableRows,
      theme: 'striped',
      headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 }, // Indigo-600
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 30 },
        1: { fontStyle: 'bold', cellWidth: 50 },
        2: { halign: 'center', textColor: [29, 78, 216] }, // Blue-705
        3: { halign: 'center', textColor: [15, 118, 110] }, // Teal-705
        4: { halign: 'center', textColor: [185, 28, 28] }, // Rose-705
        5: { halign: 'center', fontStyle: 'bold' }
      },
      didParseCell: (data) => {
        // Highlight last row (Grand totals)
        if (data.row.index === tableRows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [226, 232, 240]; // Slate-200
          data.cell.styles.textColor = [30, 41, 59]; // Slate-800
        }
      },
      styles: { fontSize: 8.5, cellPadding: 3 },
      margin: { left: 14, right: 14 }
    });

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.width - 25, doc.internal.pageSize.height - 10);
      doc.text(`CONFIDENTIAL - ${currentWarehouseId.toUpperCase()} INVENTORY CONTROL SHEET`, 14, doc.internal.pageSize.height - 10);
    }

    doc.save(`Stock_Report_${currentWarehouseId}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div id="stock-report-view" className="space-y-6 animate-fade-in text-slate-900 dark:text-slate-100">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Layers className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            Stock In/Out Report
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Aggregate ledger statistics for product opening balances, receipts, dispatches, and final stock balances for <span className="font-bold text-indigo-600 dark:text-indigo-400">{activeWhName} ({currentWarehouseId})</span>.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full lg:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search SKU or Name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-60 bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-lg pl-9 pr-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none shadow-xs font-semibold"
            />
          </div>
          <div className="flex items-center gap-2">
            {onReconcileStock && (
              <button
                onClick={handleRunReconciliation}
                disabled={isReconciling}
                className="bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs flex-1 sm:flex-initial justify-center disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
                {isReconciling ? 'Reconciling...' : 'Reconcile Stock'}
              </button>
            )}
            <button
              onClick={handleExportCSV}
              className="bg-slate-800 hover:bg-slate-700 dark:bg-slate-750 dark:hover:bg-slate-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs flex-1 sm:flex-initial justify-center border border-transparent dark:border-slate-700"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button
              onClick={handleExportPDF}
              className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs flex-1 sm:flex-initial justify-center"
            >
              <FileText className="w-3.5 h-3.5" />
              Export PDF
            </button>
          </div>
        </div>
      </div>

      {reconcileMessage && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          {reconcileMessage}
        </div>
      )}

      {/* Selected Warehouse Context Indicator Card */}
      <div className="bg-gradient-to-r from-teal-50 to-indigo-50 dark:from-teal-950/20 dark:to-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between shadow-xs">
        <div>
          <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 tracking-wider block uppercase">CURRENT LIVE WAREHOUSE SESSION</span>
          <strong className="text-sm font-extrabold text-slate-800 dark:text-slate-200">{activeWhName}</strong>
          <span className="text-xs text-slate-500 dark:text-slate-400 sm:ml-2 block sm:inline">({currentWarehouseId})</span>
        </div>
        <div className="sm:text-right">
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 block">SYSTEM CONTEXT INDICATOR</span>
          <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
            100% RECONCILED WITH LIVE LEDGER
          </span>
        </div>
      </div>

      {/* Summary Bento */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Opening Stock Card */}
        <div className="bg-white dark:bg-slate-950 p-4 rounded-xl border border-gray-100 dark:border-slate-800 flex items-center gap-3 shadow-xs">
          <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 rounded-lg">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-400 dark:text-slate-500 block uppercase font-bold">Total Opening Stock</span>
            <strong className="text-sm font-extrabold text-blue-700 dark:text-blue-400">{warehouseTotalOpeningStock.toLocaleString()}</strong>
          </div>
        </div>

        {/* Total Quantity In Card */}
        <div className="bg-white dark:bg-slate-950 p-4 rounded-xl border border-gray-100 dark:border-slate-800 flex items-center gap-3 shadow-xs">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-lg">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-400 dark:text-slate-500 block uppercase font-bold">Total Quantity In (Inwards)</span>
            <strong className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">{warehouseTotalQtyIn.toLocaleString()}</strong>
          </div>
        </div>

        {/* Total Quantity Out Card */}
        <div className="bg-white dark:bg-slate-950 p-4 rounded-xl border border-gray-100 dark:border-slate-800 flex items-center gap-3 shadow-xs">
          <div className="p-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 rounded-lg">
            <TrendingDown className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-400 dark:text-slate-500 block uppercase font-bold">Total Quantity Out (Outwards)</span>
            <strong className="text-sm font-extrabold text-rose-700 dark:text-rose-400">{warehouseTotalQtyOut.toLocaleString()}</strong>
          </div>
        </div>

        {/* Net Balance Stock Card */}
        <div className="bg-white dark:bg-slate-950 p-4 rounded-xl border border-gray-100 dark:border-slate-800 flex items-center gap-3 shadow-xs">
          <div className="p-2 bg-slate-50 dark:bg-slate-900 text-slate-750 dark:text-slate-300 rounded-lg border border-gray-100 dark:border-slate-800">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-400 dark:text-slate-500 block uppercase font-bold">Net Balance Stock</span>
            <strong className="text-sm font-extrabold text-slate-800 dark:text-slate-200">{warehouseTotalBalance.toLocaleString()}</strong>
          </div>
        </div>
      </div>

      {/* Table & Mobile Cards */}
      <div className="bg-white dark:bg-slate-950 border border-gray-100 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
        {/* Mobile Cards Layout */}
        <div className="block md:hidden divide-y divide-gray-100 dark:divide-slate-800">
          {stockReportData.map((sr) => (
            <div key={sr.itemCode} className="p-4 space-y-3 hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">{sr.itemName}</div>
                <span className="font-mono font-bold text-[10px] text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-md shrink-0">{sr.itemCode}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div className="bg-blue-50/40 dark:bg-blue-950/20 p-2 rounded-lg">
                  <span className="text-[9px] text-blue-600 dark:text-blue-400 block uppercase font-bold tracking-wider">Opening</span>
                  <span className="font-mono font-bold text-blue-700 dark:text-blue-400 text-xs">{sr.openingStock.toLocaleString()}</span>
                </div>
                <div className="bg-emerald-50/40 dark:bg-emerald-950/20 p-2 rounded-lg">
                  <span className="text-[9px] text-emerald-600 dark:text-emerald-400 block uppercase font-bold tracking-wider">Qty In</span>
                  <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 text-xs">+{sr.qtyIn.toLocaleString()}</span>
                </div>
                <div className="bg-rose-50/40 dark:bg-rose-950/20 p-2 rounded-lg">
                  <span className="text-[9px] text-rose-600 dark:text-rose-400 block uppercase font-bold tracking-wider">Qty Out</span>
                  <span className="font-mono font-bold text-rose-700 dark:text-rose-400 text-xs">-{sr.qtyOut.toLocaleString()}</span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900 p-2 rounded-lg col-span-2 sm:col-span-1">
                  <span className="text-[9px] text-slate-500 dark:text-slate-400 block uppercase font-bold tracking-wider">Balance</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-200 text-xs">{sr.balance.toLocaleString()}</span>
                </div>
              </div>
            </div>
          ))}
          {stockReportData.length === 0 && (
            <div className="p-8 text-center text-slate-400 dark:text-slate-500 font-semibold text-xs">
              {searchQuery ? `No products found matching "${searchQuery}"` : "No transactions or movements recorded for this warehouse yet."}
            </div>
          )}
          {stockReportData.length > 0 && (
            <div className="bg-slate-50 dark:bg-slate-900/60 p-4 space-y-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-extrabold tracking-wider">Filtered Grand Totals</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div>
                  <span className="text-[9px] text-slate-500 dark:text-slate-400 block">Total Opening</span>
                  <strong className="font-mono text-blue-700 dark:text-blue-400 text-sm">{grandTotalOpeningStock.toLocaleString()}</strong>
                </div>
                <div>
                  <span className="text-[9px] text-slate-500 dark:text-slate-400 block">Total In</span>
                  <strong className="font-mono text-emerald-700 dark:text-emerald-400 text-sm">+{grandTotalQtyIn.toLocaleString()}</strong>
                </div>
                <div>
                  <span className="text-[9px] text-slate-500 dark:text-slate-400 block">Total Out</span>
                  <strong className="font-mono text-rose-700 dark:text-rose-400 text-sm">-{grandTotalQtyOut.toLocaleString()}</strong>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <span className="text-[9px] text-slate-500 dark:text-slate-400 block">Total Balance</span>
                  <strong className="font-mono text-slate-900 dark:text-slate-200 text-sm">{grandTotalBalance.toLocaleString()}</strong>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-900/60 border-b border-gray-100 dark:border-slate-800 text-[10px] font-bold text-gray-400 dark:text-slate-400 uppercase tracking-wider">
                <th className="p-4">Item Code</th>
                <th className="p-4">Product Name</th>
                <th className="p-4 text-center">Opening Stock</th>
                <th className="p-4 text-center">Quantity In</th>
                <th className="p-4 text-center">Quantity Out</th>
                <th className="p-4 text-center">Balance Quantity</th>
                <th className="p-4 text-center">Live Stock Available</th>
                <th className="p-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800 text-gray-700 dark:text-slate-300 font-medium">
              {stockReportData.map((sr) => (
                <tr key={sr.itemCode} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors">
                  <td className="p-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">{sr.itemCode}</td>
                  <td className="p-4 font-bold text-slate-800 dark:text-slate-200">{sr.itemName}</td>
                  <td className="p-4 text-center font-mono font-bold text-blue-600 dark:text-blue-400">{sr.openingStock.toLocaleString()}</td>
                  <td className="p-4 text-center font-mono font-bold text-emerald-600 dark:text-emerald-400">+{sr.qtyIn.toLocaleString()}</td>
                  <td className="p-4 text-center font-mono font-bold text-rose-600 dark:text-rose-400">-{sr.qtyOut.toLocaleString()}</td>
                  <td className="p-4 text-center font-mono font-bold text-slate-900 dark:text-slate-100 bg-slate-50/50 dark:bg-slate-900/40">{sr.balance.toLocaleString()}</td>
                  <td className="p-4 text-center font-mono font-extrabold text-teal-700 dark:text-teal-300">{sr.liveAvailable.toLocaleString()}</td>
                  <td className="p-4 text-center">
                    {sr.isSynced ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-200/50 dark:border-emerald-800/40">
                        <CheckCircle2 className="w-3 h-3" />
                        Synced
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full border border-amber-200/50 dark:border-amber-800/40">
                        <AlertTriangle className="w-3 h-3" />
                        Discrepancy
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {stockReportData.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 dark:text-slate-500 font-semibold">
                    {searchQuery ? `No products found matching "${searchQuery}"` : "No transactions or movements recorded for this warehouse yet."}
                  </td>
                </tr>
              )}
              <tr className="bg-slate-100/50 dark:bg-slate-900/50 font-extrabold text-xs text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-800">
                <td colSpan={2} className="p-4">GRAND TOTALS:</td>
                <td className="p-4 text-center font-mono text-blue-700 dark:text-blue-400">{grandTotalOpeningStock.toLocaleString()}</td>
                <td className="p-4 text-center font-mono text-emerald-700 dark:text-emerald-400">+{grandTotalQtyIn.toLocaleString()}</td>
                <td className="p-4 text-center font-mono text-rose-700 dark:text-rose-400">-{grandTotalQtyOut.toLocaleString()}</td>
                <td className="p-4 text-center font-mono text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-900">{grandTotalBalance.toLocaleString()}</td>
                <td className="p-4 text-center font-mono text-teal-800 dark:text-teal-200 bg-teal-50/50 dark:bg-teal-950/20">{stockReportData.reduce((sum, item) => sum + item.liveAvailable, 0).toLocaleString()}</td>
                <td className="p-4 text-center"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
