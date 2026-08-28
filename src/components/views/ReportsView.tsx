import React, { useState } from 'react';
import { IndianRupee, Layers, TrendingUp, TrendingDown, Trash, Download, FileText, BarChart2 } from 'lucide-react';
import { Product, Stock, Transfer } from '../../types';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ReportsViewProps {
  products: Product[];
  stocks: Stock[];
  transfers: Transfer[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({ products, stocks, transfers }) => {
  const [activeReport, setActiveReport] = useState<'valuation' | 'velocity'>('valuation');

  // Calculations for Valuation
  const valuationData = products.map(p => {
    const whStocks = stocks.filter(s => s.itemCode === p.itemCode);
    const totalQty = whStocks.reduce((sum, s) => sum + s.availableQty, 0);
    const totalCost = totalQty * p.purchaseRate;
    const totalValue = totalQty * p.sellingRate;
    const potentialMargin = totalValue - totalCost;

    return {
      sku: p.itemCode,
      name: p.name,
      totalQty,
      avgPurchase: p.purchaseRate,
      avgSelling: p.sellingRate,
      totalCost,
      totalValue,
      potentialMargin
    };
  });

  const grandTotalCost = valuationData.reduce((sum, item) => sum + item.totalCost, 0);
  const grandTotalValue = valuationData.reduce((sum, item) => sum + item.totalValue, 0);
  const grandTotalMargin = grandTotalValue - grandTotalCost;

  // Stock Velocity Analysis (Moving patterns)
  const velocityData = products.map(p => {
    const transferCount = transfers.filter(t => t.itemCode === p.itemCode).length;
    const stockQty = stocks.filter(s => s.itemCode === p.itemCode).reduce((sum, s) => sum + s.availableQty, 0);

    let status: 'Fast Moving' | 'Slow Moving' | 'Dead Stock' = 'Slow Moving';
    let statusStyle = 'bg-amber-100 text-amber-800';
    
    if (transferCount >= 2) {
      status = 'Fast Moving';
      statusStyle = 'bg-emerald-100 text-emerald-800';
    } else if (transferCount === 0 && stockQty > 0) {
      status = 'Dead Stock';
      statusStyle = 'bg-rose-100 text-rose-800 animate-pulse';
    }

    return {
      sku: p.itemCode,
      name: p.name,
      category: p.category,
      availableQty: stockQty,
      transferCount,
      status,
      statusStyle
    };
  });

  // Export CSV triggers
  const handleExportCSV = (reportType: string) => {
    let headers: string[] = [];
    let rows: any[][] = [];
    let fileName = '';

    if (reportType === 'valuation') {
      headers = ['SKU / Item Code', 'Product Name', 'Total Stock', 'Purchase Rate (INR)', 'Selling Rate (INR)', 'Total Cost Valuation (INR)', 'Market Value (INR)', 'Unrealized Margin (INR)'];
      rows = valuationData.map(v => [v.sku, v.name, v.totalQty, v.avgPurchase, v.avgSelling, v.totalCost, v.totalValue, v.potentialMargin]);
      rows.push(['GRAND TOTALS', '', valuationData.reduce((sum, item) => sum + item.totalQty, 0), '', '', grandTotalCost, grandTotalValue, grandTotalMargin]);
      fileName = 'Inventory_Valuation_Report';
    } else if (reportType === 'velocity') {
      headers = ['SKU / Item Code', 'Product Name', 'Customer Name', 'Available Stock Units', 'Transfer Count', 'Velocity Status'];
      rows = velocityData.map(v => [v.sku, v.name, v.category, v.availableQty, v.transferCount, v.status]);
      fileName = 'Inventory_Velocity_Analysis';
    }

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

  const handleExportValuationPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    const nowStr = new Date().toLocaleString();

    // Title / Header
    doc.setFontSize(20);
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.text('INVENTORY ASSET VALUATION REPORT', 14, 15);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139); // Slate-500
    doc.text(`Generated: ${nowStr}`, 14, 21);
    doc.text('Status: Active Stock Ledger Valuation', 14, 25);

    // Summary Cards block drawn manually
    doc.setFillColor(248, 250, 252); // Slate-50
    doc.roundedRect(14, 30, 80, 18, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // Slate-400
    doc.text('TOTAL ASSET COST', 18, 35);
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text(`INR ${grandTotalCost.toLocaleString()}`, 18, 43);

    doc.setFillColor(240, 253, 250); // Mint-50
    doc.roundedRect(100, 30, 80, 18, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setTextColor(13, 148, 136); // Teal-600
    doc.text('MARKET SELLING VALUE', 104, 35);
    doc.setFontSize(12);
    doc.setTextColor(15, 118, 110);
    doc.text(`INR ${grandTotalValue.toLocaleString()}`, 104, 43);

    doc.setFillColor(245, 243, 255); // Purple-50
    doc.roundedRect(186, 30, 80, 18, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setTextColor(124, 58, 237); // Purple-600
    doc.text('UNREALIZED GROSS MARGIN', 190, 35);
    doc.setFontSize(12);
    doc.setTextColor(109, 40, 217);
    doc.text(`INR ${grandTotalMargin.toLocaleString()}`, 190, 43);

    // Table
    const tableHeaders = [
      'SKU / Code',
      'Product Name',
      'Total Qty',
      'Avg Buy (INR)',
      'Avg Sell (INR)',
      'Total Cost (INR)',
      'Total Market (INR)',
      'Potential Margin (INR)'
    ];

    const tableRows = valuationData.map(v => [
      v.sku,
      v.name,
      v.totalQty.toLocaleString(),
      v.avgPurchase.toLocaleString(),
      v.avgSelling.toLocaleString(),
      v.totalCost.toLocaleString(),
      v.totalValue.toLocaleString(),
      v.potentialMargin.toLocaleString()
    ]);

    // Push grand totals
    tableRows.push([
      'GRAND TOTALS',
      '',
      valuationData.reduce((sum, item) => sum + item.totalQty, 0).toLocaleString(),
      '',
      '',
      grandTotalCost.toLocaleString(),
      grandTotalValue.toLocaleString(),
      grandTotalMargin.toLocaleString()
    ]);

    autoTable(doc, {
      startY: 55,
      head: [tableHeaders],
      body: tableRows,
      theme: 'striped',
      headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 }, // Indigo-600
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 25 },
        1: { fontStyle: 'bold', cellWidth: 60 },
        2: { halign: 'center' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right', fontStyle: 'bold' },
        7: { halign: 'right', fontStyle: 'bold', textColor: [15, 118, 110] } // Emerald-700
      },
      didParseCell: (data) => {
        // Highlight last row (Grand totals)
        if (data.row.index === tableRows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [226, 232, 240]; // Slate-200
          data.cell.styles.textColor = [30, 41, 59]; // Slate-800
        }
      },
      styles: { fontSize: 8, cellPadding: 2.5 },
      margin: { left: 14, right: 14 }
    });

    // Page Numbers using didDrawPage or simple loop
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.width - 25, doc.internal.pageSize.height - 10);
      doc.text('CONFIDENTIAL - FOR INTERNAL USE ONLY', 14, doc.internal.pageSize.height - 10);
    }

    doc.save(`Valuation_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleExportVelocityPDF = () => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const nowStr = new Date().toLocaleString();

    // Title / Header
    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.text('INVENTORY VELOCITY & LOGISTICS ANALYSIS', 14, 15);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139); // Slate-500
    doc.text(`Generated: ${nowStr}`, 14, 21);
    doc.text('Methodology: Stock movement & transfer operation frequencies', 14, 25);

    // Context description
    doc.setFillColor(239, 246, 255); // Blue-50
    doc.roundedRect(14, 30, 182, 14, 1.5, 1.5, 'F');
    doc.setFontSize(8);
    doc.setTextColor(30, 58, 138); // Blue-900
    doc.text('Velocity Turn Guide: Fast Moving items have >= 2 active transfer/procurement logs.', 18, 35);
    doc.text('Slow Moving items have 1 log. Dead Stock has stock in Pcs but 0 activity, representing tied capital.', 18, 39);

    const tableHeaders = [
      'SKU / Code',
      'Product Name',
      'Category',
      'Available Stock',
      'Transfer Frequency',
      'Velocity Status'
    ];

    const tableRows = velocityData.map(v => [
      v.sku,
      v.name,
      v.category,
      v.availableQty.toLocaleString(),
      `${v.transferCount} ops`,
      v.status
    ]);

    autoTable(doc, {
      startY: 48,
      head: [tableHeaders],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 }, // Indigo-600
      columnStyles: {
        0: { fontStyle: 'bold' },
        1: { fontStyle: 'bold' },
        3: { halign: 'center' },
        4: { halign: 'center' },
        5: { halign: 'right', fontStyle: 'bold' }
      },
      didParseCell: (data) => {
        if (data.column.index === 5) {
          const statusVal = data.cell.raw;
          if (statusVal === 'Fast Moving') {
            data.cell.styles.textColor = [15, 118, 110]; // Teal-700
          } else if (statusVal === 'Dead Stock') {
            data.cell.styles.textColor = [185, 28, 28]; // Rose-700
          } else {
            data.cell.styles.textColor = [217, 119, 6]; // Amber-600
          }
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
      doc.text('CONFIDENTIAL - STRATEGIC ANALYTICS MASTER SHEET', 14, doc.internal.pageSize.height - 10);
    }

    doc.save(`Velocity_Analysis_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div id="reports-view" className="space-y-6 animate-fade-in">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Toggle Report Categories */}
        <div className="flex border border-gray-200 bg-gray-50/50 rounded-lg p-0.5 shadow-inner w-full lg:w-auto">
          <button
            onClick={() => setActiveReport('valuation')}
            className={`flex-1 lg:flex-none px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
              activeReport === 'valuation' ? 'bg-white text-indigo-600 border border-gray-100 shadow-xs' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            💰 Valuation
          </button>
          <button
            onClick={() => setActiveReport('velocity')}
            className={`flex-1 lg:flex-none px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
              activeReport === 'velocity' ? 'bg-white text-indigo-600 border border-gray-100 shadow-xs' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            ⚡ Velocity Matrix
          </button>
        </div>

        <div className="flex items-center gap-2 w-full lg:w-auto">
          <button
            onClick={() => handleExportCSV(activeReport)}
            className="flex-1 lg:flex-none bg-slate-800 hover:bg-slate-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            onClick={
              activeReport === 'valuation'
                ? handleExportValuationPDF
                : handleExportVelocityPDF
            }
            className="flex-1 lg:flex-none bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-xs"
          >
            <FileText className="w-3.5 h-3.5" />
            Export PDF
          </button>
        </div>
      </div>

      {activeReport === 'valuation' ? (
        // VALUATION REPORT
        <div className="space-y-6 animate-fade-in">
          {/* Summary Bento */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl border border-gray-100 flex items-center gap-3 shadow-xs">
              <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block uppercase font-bold">Total Asset Cost</span>
                <strong className="text-sm font-extrabold text-gray-800">₹{grandTotalCost.toLocaleString()}</strong>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-gray-100 flex items-center gap-3 shadow-xs">
              <div className="p-2 bg-emerald-50 text-emerald-700 rounded-lg">
                <IndianRupee className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block uppercase font-bold">Market Selling Value</span>
                <strong className="text-sm font-extrabold text-emerald-700">₹{grandTotalValue.toLocaleString()}</strong>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-gray-100 flex items-center gap-3 shadow-xs">
              <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
                <BarChart2 className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block uppercase font-bold">Unrealized Gross Margin</span>
                <strong className="text-sm font-extrabold text-indigo-700">₹{grandTotalMargin.toLocaleString()}</strong>
              </div>
            </div>
          </div>

          {/* Valuation table & Cards */}
          <div className="bg-white border border-gray-100 rounded-xl shadow-xs overflow-hidden">
            {/* Mobile Cards Layout */}
            <div className="block lg:hidden divide-y divide-gray-100">
              {valuationData.map((v) => (
                <div key={v.sku} className="p-4 space-y-3 hover:bg-slate-50/50 transition-colors text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-bold text-slate-800 text-sm">{v.name}</div>
                    <span className="font-mono font-bold text-[10px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md shrink-0">{v.sku}</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 pt-1">
                    <div>
                      <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-wider">Total Quantity</span>
                      <span className="font-mono font-bold text-slate-900 text-xs">{v.totalQty.toLocaleString()} Pcs</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-wider">Potential Margin</span>
                      <span className="font-mono font-bold text-emerald-700 text-xs">₹{v.potentialMargin.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 block uppercase font-bold tracking-wider">Cost Valuation</span>
                      <span className="font-mono font-medium text-slate-600 text-xs">₹{v.totalCost.toLocaleString()} <span className="text-[9px] text-slate-400">(₹{v.avgPurchase}/ea)</span></span>
                    </div>
                    <div>
                      <span className="text-[10px] text-indigo-500 block uppercase font-bold tracking-wider">Market Value</span>
                      <span className="font-mono font-bold text-indigo-600 text-xs">₹{v.totalValue.toLocaleString()} <span className="text-[9px] text-indigo-400">(₹{v.avgSelling}/ea)</span></span>
                    </div>
                  </div>
                </div>
              ))}
              
              {valuationData.length > 0 && (
                <div className="bg-slate-50 p-4 space-y-2.5 border-t border-slate-200 text-xs">
                  <span className="text-[10px] text-slate-400 block uppercase font-extrabold tracking-wider">Asset Grand Totals</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex justify-between sm:block bg-white p-2.5 rounded-lg border border-gray-100 shadow-3xs">
                      <span className="text-[9px] text-slate-500 block">Total Qty:</span>
                      <strong className="font-mono text-slate-900 text-xs sm:text-sm">{valuationData.reduce((sum, item) => sum + item.totalQty, 0).toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between sm:block bg-white p-2.5 rounded-lg border border-gray-100 shadow-3xs">
                      <span className="text-[9px] text-slate-500 block">Total Cost:</span>
                      <strong className="font-mono text-slate-900 text-xs sm:text-sm">₹{grandTotalCost.toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between sm:block bg-indigo-50/40 p-2.5 rounded-lg border border-indigo-100 shadow-3xs">
                      <span className="text-[9px] text-indigo-600 block">Total Market Value:</span>
                      <strong className="font-mono text-indigo-700 text-xs sm:text-sm">₹{grandTotalValue.toLocaleString()}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    <th className="p-4">SKU / Item Code</th>
                    <th className="p-4">Product Catalog Name</th>
                    <th className="p-4 text-center">Total Qty Across Warehouses</th>
                    <th className="p-4 text-right">Avg Buy Rate</th>
                    <th className="p-4 text-right">Avg Sell Rate</th>
                    <th className="p-4 text-right">Total Cost Valuation</th>
                    <th className="p-4 text-right bg-indigo-50/5 text-indigo-700">Total Market Value</th>
                    <th className="p-4 text-right">Potential Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-gray-700 font-medium">
                  {valuationData.map((v) => (
                    <tr key={v.sku} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-4 font-mono font-bold text-indigo-700">{v.sku}</td>
                      <td className="p-4 font-bold text-slate-800">{v.name}</td>
                      <td className="p-4 text-center font-mono font-bold text-gray-900">{v.totalQty.toLocaleString()}</td>
                      <td className="p-4 text-right font-mono text-gray-500">₹{v.avgPurchase}</td>
                      <td className="p-4 text-right font-mono text-gray-500">₹{v.avgSelling}</td>
                      <td className="p-4 text-right font-mono text-gray-900">₹{v.totalCost.toLocaleString()}</td>
                      <td className="p-4 text-right font-mono text-indigo-600 font-bold bg-indigo-50/5">₹{v.totalValue.toLocaleString()}</td>
                      <td className="p-4 text-right font-mono font-bold text-emerald-700">₹{v.potentialMargin.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100/50 font-extrabold text-xs text-slate-900 border-t border-slate-200">
                    <td colSpan={2} className="p-4">GRAND TOTALS:</td>
                    <td className="p-4 text-center font-mono">{valuationData.reduce((sum, item) => sum + item.totalQty, 0).toLocaleString()}</td>
                    <td colSpan={2} className="p-4"></td>
                    <td className="p-4 text-right font-mono">₹{grandTotalCost.toLocaleString()}</td>
                    <td className="p-4 text-right font-mono text-indigo-700 bg-indigo-50/10">₹{grandTotalValue.toLocaleString()}</td>
                    <td className="p-4 text-right font-mono text-emerald-700">₹{grandTotalMargin.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        // VELOCITY REPORT
        <div className="space-y-4 animate-fade-in">
          {/* Velocity Explanatory */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-[11px] leading-relaxed text-indigo-900 font-medium">
            💡 <strong>Inventory Turn Velocity:</strong> 
            This matrix tracks the turnover speed of catalog items. 
            <strong>Fast Moving</strong> items have a frequency of transfer & procurement of 2 or more active operations. 
            <strong>Dead Stock</strong> has stock available but has recorded 0 operations, signaling capital tied up in slow-moving assets.
          </div>

          <div className="bg-white border border-gray-100 rounded-xl shadow-xs overflow-hidden">
            {/* Mobile Cards Layout */}
            <div className="block lg:hidden divide-y divide-gray-100">
              {velocityData.map((v) => (
                <div key={v.sku} className="p-4 space-y-3 hover:bg-slate-50/50 transition-colors text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-800 text-sm">{v.name}</div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">{v.category}</span>
                    </div>
                    <span className="font-mono font-bold text-[10px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md shrink-0">{v.sku}</span>
                  </div>
                  
                  <div className="flex items-center justify-between bg-slate-50/50 p-2.5 rounded-lg border border-gray-100">
                    <div>
                      <span className="text-[9px] text-slate-400 block uppercase font-bold tracking-wider">Available Stock</span>
                      <span className="font-mono font-extrabold text-slate-800">{v.availableQty.toLocaleString()} Pcs</span>
                    </div>
                    <div className="text-center">
                      <span className="text-[9px] text-slate-400 block uppercase font-bold tracking-wider">Transfer Ops</span>
                      <span className="font-mono font-bold text-indigo-600">{v.transferCount} ops</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] text-slate-400 block uppercase font-bold tracking-wider mb-0.5">Velocity</span>
                      <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-extrabold ${v.statusStyle} uppercase`}>
                        {v.status === 'Fast Moving' && <TrendingUp className="w-3 h-3 text-emerald-700 shrink-0" />}
                        {v.status === 'Dead Stock' && <TrendingDown className="w-3 h-3 text-rose-700 shrink-0" />}
                        {v.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    <th className="p-4">SKU / Item Code</th>
                    <th className="p-4">Product Name</th>
                    <th className="p-4">Customer Name</th>
                    <th className="p-4 text-center">Available stock Units</th>
                    <th className="p-4 text-center">Logistics Transfer Frequency</th>
                    <th className="p-4 text-right">Turn Velocity Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-gray-700 font-medium">
                  {velocityData.map((v) => (
                    <tr key={v.sku} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-4 font-mono font-bold text-indigo-700">{v.sku}</td>
                      <td className="p-4 font-bold text-slate-800">{v.name}</td>
                      <td className="p-4 text-gray-500">{v.category}</td>
                      <td className="p-4 text-center font-mono">{v.availableQty}</td>
                      <td className="p-4 text-center font-mono font-bold text-indigo-600 bg-indigo-50/10">{v.transferCount} ops</td>
                      <td className="p-4 text-right">
                        <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-extrabold ${v.statusStyle} uppercase`}>
                          {v.status === 'Fast Moving' && <TrendingUp className="w-3 h-3 text-emerald-700 shrink-0" />}
                          {v.status === 'Dead Stock' && <TrendingDown className="w-3 h-3 text-rose-700 shrink-0" />}
                          {v.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
