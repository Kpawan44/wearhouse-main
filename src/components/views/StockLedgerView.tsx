import React, { useState, useEffect, useMemo } from 'react';
import { 
  FileText, 
  Shield, 
  Search, 
  Calendar, 
  RefreshCw, 
  UserCheck, 
  Eye, 
  Download, 
  Trash2, 
  Activity, 
  TrendingUp, 
  ArrowUpRight, 
  ArrowDownRight,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RotateCcw
} from 'lucide-react';
import { StockMovement, AuditLog, UserRole, Product, Warehouse, InventoryException, Stock, ReconciliationReportSummary } from '../../types';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { InventoryExceptionsView } from './InventoryExceptionsView';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend
} from 'recharts';

interface StockLedgerViewProps {
  movements: StockMovement[];
  auditLogs: AuditLog[];
  onPurgeAllData: () => Promise<void>;
  onReverseMovement: (id: string) => Promise<void>;
  onRevertAdjustment?: (id: string, reason?: string) => Promise<void>;
  onReconcileStock: () => Promise<any>;
  onDeleteProduct: (id: string) => Promise<void>;
  currentUserRole: UserRole;
  currentUserName?: string;
  products: Product[];
  warehouses: Warehouse[];
  stocks?: Stock[];
  exceptions?: InventoryException[];
  onResolveException?: (exceptionId: string, resolutionNote: string, resolutionTransactionId?: string) => Promise<void>;
  onMarkExceptionUnderReview?: (exceptionId: string, notes?: string) => Promise<void>;
  lastReport?: ReconciliationReportSummary | null;
  onNavigateToAdjustment?: () => void;
  onAutoCorrectExceptions?: () => Promise<void>;
}

export const StockLedgerView: React.FC<StockLedgerViewProps> = ({
  movements,
  auditLogs,
  onPurgeAllData,
  onReverseMovement,
  onRevertAdjustment,
  onReconcileStock,
  onDeleteProduct,
  currentUserRole,
  currentUserName = 'Authorized Auditor',
  products,
  warehouses,
  stocks = [],
  exceptions = [],
  onResolveException = async () => {},
  onMarkExceptionUnderReview = async () => {},
  lastReport,
  onNavigateToAdjustment,
  onAutoCorrectExceptions
}) => {
  const [activeTab, setActiveTab] = useState<'ledger' | 'item_wise_ledger' | 'audit' | 'import_logs' | 'exceptions'>('ledger');
  const [searchQuery, setSearchQuery] = useState('');
  const [txFilter, setTxFilter] = useState('All');
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});

  // Item-wise ledger state variables
  const [selectedItemCodeLedger, setSelectedItemCodeLedger] = useState<string>('');
  const [selectedWarehouseLedger, setSelectedWarehouseLedger] = useState<string>('All');
  const [fromDateLedger, setFromDateLedger] = useState<string>('');
  const [toDateLedger, setToDateLedger] = useState<string>('');

  // Default selected item in Item-wise ledger tab
  useEffect(() => {
    if (products.length > 0 && !selectedItemCodeLedger) {
      setSelectedItemCodeLedger(products[0].itemCode);
    }
  }, [products, selectedItemCodeLedger]);

  // Item-Wise Ledger computations
  const itemWiseLedgerData = useMemo(() => {
    if (!selectedItemCodeLedger) return { openingBalance: 0, ledgerRows: [], totalIn: 0, totalOut: 0, closingBalance: 0 };

    // 1. Filter movements by selected item code
    let filtered = movements.filter(m => m.itemCode === selectedItemCodeLedger);

    // Apply search query inside selected item ledger if search query exists
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(m => 
        m.referenceNumber.toLowerCase().includes(q) || 
        m.remarks.toLowerCase().includes(q) ||
        m.user.toLowerCase().includes(q)
      );
    }

    // 2. Filter movements by warehouse if not 'All'
    if (selectedWarehouseLedger !== 'All') {
      filtered = filtered.filter(m => m.warehouseId === selectedWarehouseLedger);
    }

    // 3. Sort chronologically (oldest to newest) to correctly accumulate running balance
    const sorted = [...filtered].sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.time.localeCompare(b.time);
    });

    let openingBalance = 0;
    const currentRangeMvts: StockMovement[] = [];

    // 4. Calculate opening balance (cumulative before fromDate) and filter within range
    sorted.forEach(m => {
      const isBeforeFromDate = fromDateLedger ? m.date < fromDateLedger : false;
      const isAfterToDate = toDateLedger ? m.date > toDateLedger : false;

      if (isBeforeFromDate) {
        openingBalance += m.qty;
      } else if (!isAfterToDate) {
        currentRangeMvts.push(m);
      }
    });

    let runningBalance = openingBalance;
    let totalIn = 0;
    let totalOut = 0;

    const ledgerRows = currentRangeMvts.map(m => {
      const qtyIn = m.qty > 0 ? m.qty : 0;
      const qtyOut = m.qty < 0 ? Math.abs(m.qty) : 0;
      runningBalance += m.qty;
      totalIn += qtyIn;
      totalOut += qtyOut;

      return {
        ...m,
        qtyIn,
        qtyOut,
        runningBalance
      };
    });

    return {
      openingBalance,
      ledgerRows,
      totalIn,
      totalOut,
      closingBalance: runningBalance
    };
  }, [movements, selectedItemCodeLedger, selectedWarehouseLedger, fromDateLedger, toDateLedger, searchQuery]);

  // Export CSV for Item Wise Ledger
  const handleExportItemWiseCSV = () => {
    const item = products.find(p => p.itemCode === selectedItemCodeLedger);
    const itemName = item ? item.name : selectedItemCodeLedger;
    const headers = ['Date', 'Time', 'Warehouse', 'Transaction Type', 'Ref Number', 'Qty In (Receipt)', 'Qty Out (Issue)', 'Running Balance', 'Posted By', 'Remarks'];
    
    const rows = [
      ['Opening Balance', '', '', '', '', '', '', itemWiseLedgerData.openingBalance, '', '']
    ];

    itemWiseLedgerData.ledgerRows.forEach(r => {
      rows.push([
        r.date,
        r.time,
        r.warehouseName,
        r.transactionType,
        r.referenceNumber,
        r.qtyIn ? `+${r.qtyIn}` : '0',
        r.qtyOut ? `-${r.qtyOut}` : '0',
        r.runningBalance,
        r.user,
        r.remarks
      ]);
    });

    rows.push(['Closing Balance', '', '', '', '', itemWiseLedgerData.totalIn, itemWiseLedgerData.totalOut, itemWiseLedgerData.closingBalance, '', '']);

    const csvTitle = `Item_Ledger_${selectedItemCodeLedger}_${selectedWarehouseLedger}`;
    const csvContent = [headers, ...rows].map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${csvTitle}_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export PDF for Item Wise Ledger
  const handleExportItemWisePDF = () => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const nowStr = new Date().toLocaleString();
    const item = products.find(p => p.itemCode === selectedItemCodeLedger);
    const itemName = item ? item.name : selectedItemCodeLedger;
    const whName = selectedWarehouseLedger === 'All' ? 'All Warehouses' : (warehouses.find(w => w.code === selectedWarehouseLedger)?.name || selectedWarehouseLedger);

    doc.setFontSize(16);
    doc.text('ITEM-WISE STOCK LEDGER CARD', 14, 15);

    doc.setFontSize(9.5);
    doc.text(`Product: [${selectedItemCodeLedger}] ${itemName}`, 14, 21);
    doc.text(`Warehouse Scope: ${whName}`, 14, 26);

    doc.setFontSize(8);
    const dateRangeStr = `Date Range: ${fromDateLedger || 'Beginning of time'} to ${toDateLedger || 'Present'}`;
    doc.text(`Generated: ${nowStr} | ${dateRangeStr}`, 14, 31);

    // Summary block (4 cards)
    doc.setFillColor(239, 246, 255); // Blue
    doc.roundedRect(14, 35, 42, 18, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(37, 99, 235);
    doc.text('OPENING BALANCE', 17, 40);
    doc.setFontSize(11);
    doc.setTextColor(29, 78, 216);
    doc.text(`${itemWiseLedgerData.openingBalance}`, 17, 48);

    doc.setFillColor(240, 253, 250); // Teal
    doc.roundedRect(60.6, 35, 42, 18, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(13, 148, 136);
    doc.text('TOTAL QTY IN (+)', 63.6, 40);
    doc.setFontSize(11);
    doc.setTextColor(15, 118, 110);
    doc.text(`+${itemWiseLedgerData.totalIn}`, 63.6, 48);

    doc.setFillColor(254, 242, 242); // Rose
    doc.roundedRect(107.2, 35, 42, 18, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(220, 38, 38);
    doc.text('TOTAL QTY OUT (-)', 110.2, 40);
    doc.setFontSize(11);
    doc.setTextColor(185, 28, 28);
    doc.text(`-${itemWiseLedgerData.totalOut}`, 110.2, 48);

    doc.setFillColor(243, 244, 246); // Gray
    doc.roundedRect(153.8, 35, 42, 18, 2, 2, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(75, 85, 99);
    doc.text('CLOSING BALANCE', 156.8, 40);
    doc.setFontSize(11);
    doc.setTextColor(31, 41, 55);
    doc.text(`${itemWiseLedgerData.closingBalance}`, 156.8, 48);

    const tableHeaders = [
      'Timestamp',
      'Warehouse',
      'Transaction Type',
      'Ref Doc #',
      'In (+)',
      'Out (-)',
      'Balance'
    ];

    const tableRows = itemWiseLedgerData.ledgerRows.map(r => [
      `${r.date} ${r.time}`,
      r.warehouseName,
      r.transactionType,
      r.referenceNumber,
      r.qtyIn ? `+${r.qtyIn}` : '0',
      r.qtyOut ? `-${r.qtyOut}` : '0',
      r.runningBalance.toLocaleString()
    ]);

    // Insert Opening row at beginning
    tableRows.unshift([
      'START OF RANGE',
      'N/A',
      'Opening Balance',
      'N/A',
      '0',
      '0',
      itemWiseLedgerData.openingBalance.toLocaleString()
    ]);

    autoTable(doc, {
      startY: 58,
      head: [tableHeaders],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 26 },
        1: { cellWidth: 35 },
        2: { fontSize: 7.5, cellWidth: 35 },
        3: { fontStyle: 'bold', cellWidth: 25 },
        4: { halign: 'center', textColor: [16, 185, 129], fontStyle: 'bold' },
        5: { halign: 'center', textColor: [239, 68, 68], fontStyle: 'bold' },
        6: { halign: 'center', fontStyle: 'bold' }
      },
      styles: { fontSize: 8, cellPadding: 2.5 },
      margin: { left: 14, right: 14 }
    });

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.width - 25, doc.internal.pageSize.height - 10);
      doc.text(`PRODUCT TRANSACTION LEDGER CARD [SKU: ${selectedItemCodeLedger}]`, 14, doc.internal.pageSize.height - 10);
    }

    doc.save(`Item_Ledger_${selectedItemCodeLedger}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // Extract all unique products that have movements or are in the catalog
  const uniqueItems = useMemo(() => {
    const map = new Map<string, { itemName: string; isDeleted: boolean }>();
    
    // First, populate with all products in the catalog (active items)
    products.forEach(p => {
      map.set(p.itemCode, { itemName: p.name, isDeleted: false });
    });
    
    // Next, add any items from movements (captures historical/deleted items too)
    movements.forEach(m => {
      if (m.itemCode && m.itemName) {
        if (!map.has(m.itemCode)) {
          map.set(m.itemCode, { itemName: m.itemName, isDeleted: true });
        }
      }
    });
    
    return Array.from(map.entries()).map(([code, info]) => ({
      itemCode: code,
      itemName: info.itemName,
      isDeleted: info.isDeleted
    }));
  }, [products, movements]);

  const [selectedItemCode, setSelectedItemCode] = useState<string>('');

  // Default selected item to first item when list is populated
  useEffect(() => {
    if (uniqueItems.length > 0 && (!selectedItemCode || !uniqueItems.some(item => item.itemCode === selectedItemCode))) {
      setSelectedItemCode(uniqueItems[0].itemCode);
    }
  }, [uniqueItems, selectedItemCode]);

  // Generate last 30 days
  const last30Days = useMemo(() => {
    const dates: string[] = [];
    const baseDate = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(baseDate.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      dates.push(`${yyyy}-${mm}-${dd}`);
    }
    return dates;
  }, []);

  // Format YYYY-MM-DD to "MMM DD"
  const formatDateForXAxis = (dateStr: string) => {
    try {
      const [yyyy, mm, dd] = dateStr.split('-');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthIndex = parseInt(mm, 10) - 1;
      return `${months[monthIndex]} ${dd}`;
    } catch (e) {
      return dateStr;
    }
  };

  // Compute chart data for selected item
  const trendData = useMemo(() => {
    if (!selectedItemCode) return [];
    return last30Days.map(date => {
      const dayMovements = movements.filter(m => m.itemCode === selectedItemCode && m.date === date);
      let inward = 0;
      let outward = 0;
      dayMovements.forEach(m => {
        if (m.qty > 0) {
          if (m.transactionType === 'Transfer In' || m.transactionType === 'Transfer Out') {
            // Transfers also count
            if (m.qty > 0) inward += m.qty;
          } else {
            inward += m.qty;
          }
        } else if (m.qty < 0) {
          outward += Math.abs(m.qty);
        }
      });
      return {
        date,
        displayDate: formatDateForXAxis(date),
        Inward: inward,
        Outward: outward
      };
    });
  }, [selectedItemCode, last30Days, movements]);

  // Compute 30-day stats summary
  const trendStats = useMemo(() => {
    let totalInward = 0;
    let totalOutward = 0;
    let maxInward = 0;
    let maxOutward = 0;

    trendData.forEach(d => {
      totalInward += d.Inward;
      totalOutward += d.Outward;
      if (d.Inward > maxInward) maxInward = d.Inward;
      if (d.Outward > maxOutward) maxOutward = d.Outward;
    });

    return {
      totalInward,
      totalOutward,
      netChange: totalInward - totalOutward,
      maxInward,
      maxOutward
    };
  }, [trendData]);

  const txTypes = ['All', 'Inward (GRN)', 'Outward (Dispatch)', 'Transfer Out', 'Transfer In', 'Adjustment (Add)', 'Adjustment (Sub)', 'Adjustment (Damage)'];

  const filteredMovements = movements.filter(mvt => {
    const matchesSearch = mvt.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mvt.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mvt.referenceNumber.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = txFilter === 'All' || mvt.transactionType === txFilter;
    return matchesSearch && matchesType;
  });

  const filteredAuditLogs = auditLogs.filter(log =>
    log.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.module.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter and parse bulk import logs
  const parsedImportLogs = useMemo(() => {
    return auditLogs
      .map(log => {
        let parsed: any = null;
        try {
          if (log.details.trim().startsWith('{')) {
            const data = JSON.parse(log.details);
            if (data && data.type === 'bulk_import') {
              parsed = data;
            }
          }
        } catch (e) {
          // not json
        }

        // If not parsed JSON, but is a legacy bulk import string, construct a mock representation
        if (!parsed && (log.action.includes('Bulk Import') || log.action.includes('Import'))) {
          const isProduct = log.module.includes('Product') || log.action.includes('SKU') || log.action.includes('product');
          const importType = isProduct ? 'Products' : 'Customers';
          const match = log.details.match(/\d+/);
          const count = match ? parseInt(match[0], 10) : 0;
          parsed = {
            type: 'bulk_import',
            fileName: 'bulk_import_legacy.csv',
            importType: importType,
            totalRows: count,
            successCount: count,
            skippedCount: 0,
            status: 'success',
            errors: []
          };
        }

        return {
          ...log,
          parsed
        };
      })
      .filter(item => item.parsed !== null);
  }, [auditLogs]);

  const filteredImportLogs = useMemo(() => {
    return parsedImportLogs.filter(item => {
      const query = searchQuery.toLowerCase();
      if (!query) return true;
      const parsed = item.parsed;
      const matchesFileName = parsed?.fileName?.toLowerCase().includes(query);
      const matchesOperator = item.user.toLowerCase().includes(query);
      const matchesModule = item.module.toLowerCase().includes(query);
      const matchesErrors = parsed?.errors?.some((err: string) => err.toLowerCase().includes(query));
      return matchesFileName || matchesOperator || matchesModule || matchesErrors;
    });
  }, [parsedImportLogs, searchQuery]);

  // CSV Export for ledger
  const handleExportLedgerCSV = () => {
    const headers = ['Date', 'Time', 'Item Code', 'Item Name', 'Warehouse', 'From Warehouse', 'To Warehouse', 'Quantity Change', 'Posted By', 'Transaction Type', 'Ref Number', 'Remarks'];
    const rows = filteredMovements.map(m => [
      m.date,
      m.time,
      m.itemCode,
      m.itemName,
      m.warehouseName,
      m.fromWarehouseName || 'N/A',
      m.toWarehouseName || 'N/A',
      m.qty,
      m.user,
      m.transactionType,
      m.referenceNumber,
      m.remarks
    ]);

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Stock_Ledger_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportLedgerPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    const nowStr = new Date().toLocaleString();

    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text('STOCK LEDGER TRANSACTION LIST', 14, 15);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${nowStr} | Type Filter: ${txFilter} | Search Query: ${searchQuery || 'None'}`, 14, 21);

    const tableHeaders = [
      'Timestamp',
      'SKU / Code',
      'Item Name',
      'Fulfillment Center',
      'Qty Delta',
      'Movement Type',
      'Ref Doc Number',
      'Posted By'
    ];

    const tableRows = filteredMovements.slice().reverse().map(m => [
      `${m.date} ${m.time}`,
      m.itemCode,
      m.itemName,
      m.warehouseName + (m.fromWarehouseId ? ` (Trsf: ${m.fromWarehouseName?.split(' (')[0]} -> ${m.toWarehouseName?.split(' (')[0]})` : ''),
      m.qty > 0 ? `+${m.qty}` : `${m.qty}`,
      m.transactionType,
      m.referenceNumber,
      m.user
    ]);

    autoTable(doc, {
      startY: 28,
      head: [tableHeaders],
      body: tableRows,
      theme: 'striped',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { fontStyle: 'normal', cellWidth: 25 },
        1: { fontStyle: 'bold', textColor: [79, 70, 229], cellWidth: 22 },
        2: { cellWidth: 55 },
        3: { cellWidth: 45 },
        4: { halign: 'center', fontStyle: 'bold' },
        5: { fontSize: 7.5 },
        6: { fontStyle: 'bold', cellWidth: 25 }
      },
      didParseCell: (data) => {
        if (data.column.index === 4 && data.cell.raw) {
          const valStr = String(data.cell.raw);
          if (valStr.startsWith('+')) {
            data.cell.styles.textColor = [16, 185, 129]; // Emerald-500
          } else {
            data.cell.styles.textColor = [239, 68, 68]; // Rose-500
          }
        }
      },
      styles: { fontSize: 8, cellPadding: 2 },
      margin: { left: 14, right: 14 }
    });

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.width - 25, doc.internal.pageSize.height - 10);
      doc.text('IMMUTABLE TRANSACTION TRACE SHEET', 14, doc.internal.pageSize.height - 10);
    }

    doc.save(`Stock_Ledger_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleExportAuditCSV = () => {
    const headers = ['Date', 'Time', 'Operator User', 'Operational Action', 'Module Code', 'Detailed Record Parameters'];
    const rows = filteredAuditLogs.map(log => [
      log.date,
      log.time,
      log.user,
      log.action,
      log.module,
      log.details
    ]);

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Security_Audit_Logs_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportAuditPDF = () => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const nowStr = new Date().toLocaleString();

    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text('SECURITY AUDIT LOGS REPORT', 14, 15);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${nowStr} | Search Query: ${searchQuery || 'None'}`, 14, 21);

    const tableHeaders = [
      'Timestamp',
      'Operator User',
      'Operational Action',
      'Module',
      'Detailed Record Parameters'
    ];

    const tableRows = filteredAuditLogs.slice().reverse().map(log => [
      `${log.date} ${log.time}`,
      log.user,
      log.action,
      log.module,
      log.details
    ]);

    autoTable(doc, {
      startY: 28,
      head: [tableHeaders],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 }, // Slate-900
      columnStyles: {
        0: { fontStyle: 'normal', cellWidth: 25 },
        1: { fontStyle: 'bold', cellWidth: 35 },
        2: { fontStyle: 'bold', cellWidth: 40 },
        3: { fontStyle: 'normal', cellWidth: 25 },
        4: { fontSize: 7.5 }
      },
      styles: { fontSize: 8, cellPadding: 2 },
      margin: { left: 14, right: 14 }
    });

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.width - 25, doc.internal.pageSize.height - 10);
      doc.text('SYSTEM ACCESS GATEKEEPER AUDIT TRAIL', 14, doc.internal.pageSize.height - 10);
    }

    doc.save(`Security_Audit_Logs_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // CSV Export for Bulk Import Logs
  const handleExportImportCSV = () => {
    const headers = ['Date', 'Time', 'Operator', 'Module', 'Import Type', 'File Name', 'Total Rows', 'Success Count', 'Skipped Count', 'Status', 'Errors'];
    const rows = filteredImportLogs.map(log => {
      const p = log.parsed;
      return [
        log.date,
        log.time,
        log.user,
        log.module,
        p?.importType || 'N/A',
        p?.fileName || 'N/A',
        p?.totalRows || 0,
        p?.successCount || 0,
        p?.skippedCount || 0,
        p?.status || 'unknown',
        p?.errors?.join(' | ') || ''
      ];
    });

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Bulk_Import_Audit_Logs_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // PDF Export for Bulk Import Logs
  const handleExportImportPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    const nowStr = new Date().toLocaleString();

    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text('BULK IMPORT OPERATIONS AUDIT LOGS', 14, 15);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${nowStr} | Search Query: ${searchQuery || 'None'}`, 14, 21);

    const tableHeaders = [
      'Timestamp',
      'Operator',
      'Import Type',
      'File Name',
      'Total Rows',
      'Imported',
      'Skipped',
      'Status',
      'Errors'
    ];

    const tableRows = filteredImportLogs.slice().reverse().map(log => {
      const p = log.parsed;
      return [
        `${log.date} ${log.time}`,
        log.user,
        p?.importType || 'N/A',
        p?.fileName || 'N/A',
        String(p?.totalRows || 0),
        String(p?.successCount || 0),
        String(p?.skippedCount || 0),
        String(p?.status || 'unknown').toUpperCase(),
        p?.errors && p.errors.length > 0 ? p.errors.join(', ') : 'None'
      ];
    });

    autoTable(doc, {
      startY: 28,
      head: [tableHeaders],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 25 },
        2: { cellWidth: 22 },
        3: { cellWidth: 40 },
        4: { cellWidth: 18 },
        5: { cellWidth: 18 },
        6: { cellWidth: 18 },
        7: { cellWidth: 25 },
        8: { fontSize: 7 }
      },
      styles: { fontSize: 8, cellPadding: 2 },
      margin: { left: 14, right: 14 }
    });

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.width - 25, doc.internal.pageSize.height - 10);
      doc.text('BULK IMPORT OPERATIONS AUDIT TRAIL', 14, doc.internal.pageSize.height - 10);
    }

    doc.save(`Bulk_Import_Audit_Logs_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div id="stock-ledger-view" className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Toggle between Ledger, Item-wise, Audit, Import Logs and Exceptions */}
        <div className="flex border border-gray-200 bg-gray-50/50 rounded-lg p-0.5 shadow-inner flex-wrap">
          <button
            onClick={() => { setActiveTab('ledger'); setSearchQuery(''); }}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
              activeTab === 'ledger' ? 'bg-white text-indigo-600 border border-gray-100 shadow-xs' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            📊 Stock Ledger
          </button>
          <button
            onClick={() => { setActiveTab('item_wise_ledger'); setSearchQuery(''); }}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
              activeTab === 'item_wise_ledger' ? 'bg-white text-blue-600 border border-gray-100 shadow-xs' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            🔍 Item-Wise Ledger Card
          </button>
          <button
            onClick={() => { setActiveTab('exceptions'); setSearchQuery(''); }}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
              activeTab === 'exceptions' ? 'bg-white text-purple-600 border border-gray-100 shadow-xs font-bold' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            🛡️ Reconciliation & Exceptions
            {exceptions.filter(e => e.status === 'OPEN').length > 0 && (
              <span className="bg-rose-500 text-white text-[10px] font-extrabold px-1.5 py-0.2 rounded-full">
                {exceptions.filter(e => e.status === 'OPEN').length}
              </span>
            )}
          </button>
          <button
            onClick={() => { setActiveTab('audit'); setSearchQuery(''); }}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
              activeTab === 'audit' ? 'bg-white text-rose-600 border border-gray-100 shadow-xs' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            🛡️ Security Audit Logs
          </button>
          <button
            onClick={() => { setActiveTab('import_logs'); setSearchQuery(''); }}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
              activeTab === 'import_logs' ? 'bg-white text-emerald-600 border border-gray-100 shadow-xs' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            📥 Bulk Import Audits
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          {activeTab === 'ledger' && (
            <select
              value={txFilter}
              onChange={(e) => setTxFilter(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-xs"
            >
              {txTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}

          {activeTab !== 'exceptions' && (
            <input
              type="text"
              placeholder={
                activeTab === 'ledger' ? "Search SKU or Ref..." : 
                activeTab === 'item_wise_ledger' ? "Search within ledger..." : 
                activeTab === 'audit' ? "Search action or user..." : 
                "Search file, operator, or errors..."
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none w-48 shadow-xs"
            />
          )}

          {activeTab !== 'exceptions' && (
            <div className="flex items-center gap-1">
              <button
                onClick={
                  activeTab === 'ledger' ? handleExportLedgerCSV : 
                  activeTab === 'item_wise_ledger' ? handleExportItemWiseCSV : 
                  activeTab === 'audit' ? handleExportAuditCSV : 
                  handleExportImportCSV
                }
                className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                title="Export CSV"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
              <button
                onClick={
                  activeTab === 'ledger' ? handleExportLedgerPDF : 
                  activeTab === 'item_wise_ledger' ? handleExportItemWisePDF : 
                  activeTab === 'audit' ? handleExportAuditPDF : 
                  handleExportImportPDF
                }
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                title="Export PDF"
              >
                <FileText className="w-3.5 h-3.5" /> PDF
              </button>
            </div>
          )}

          {currentUserRole === 'Super Admin' && (
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  try {
                    const res = await onReconcileStock();
                    setActiveTab('exceptions');
                  } catch (err: any) {
                    alert(`Reconciliation failed: ${err.message || err}`);
                  }
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                title="Verify database consistency and detect exceptions"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reconcile Stock
              </button>

              <button
                onClick={() => {
                  if (window.confirm("CRITICAL WARNING: This will permanently delete all product catalogs, warehouse locations, stock records, grn entries, transfer documents, and audit logs. This action cannot be reversed.\n\nAre you sure you want to proceed?")) {
                    const check = window.prompt("Type 'CONFIRM' to verify full database wipe:");
                    if (check === "CONFIRM") {
                      onPurgeAllData();
                    } else {
                      alert("Wipe cancelled: CONFIRM key phrase did not match.");
                    }
                  }
                }}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs animate-pulse"
                title="Purge System Database"
              >
                <Trash2 className="w-3.5 h-3.5" /> Purge Database
              </button>
            </div>
          )}
        </div>
      </div>

      {activeTab === 'exceptions' ? (
        <InventoryExceptionsView
          exceptions={exceptions}
          products={products}
          warehouses={warehouses}
          stocks={stocks}
          currentUserRole={currentUserRole}
          currentUserName={currentUserName}
          onReconcileStock={onReconcileStock}
          onResolveException={onResolveException}
          onMarkExceptionUnderReview={onMarkExceptionUnderReview}
          lastReport={lastReport}
          onNavigateToAdjustment={onNavigateToAdjustment}
          onAutoCorrectExceptions={onAutoCorrectExceptions}
        />
      ) : activeTab === 'item_wise_ledger' ? (
        // ITEM-WISE RUNNING LEDGER
        <div className="space-y-6 animate-fade-in">
          <div className="bg-blue-50 border border-blue-100 text-blue-900 rounded-xl p-4 text-[11px] flex items-start gap-2.5 leading-normal font-semibold">
            <span>🔍</span>
            <div>
              <strong>Item Ledger Analysis:</strong> Track the exact chronological movement history, documents, and running stock balance for a specific item SKU. 
              Cumulative movements before the selected start date are automatically aggregated into the opening balance.
            </div>
          </div>

          {/* Filter Toolbar Card */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-xs p-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              {/* Product SKU Selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">1. Select Product SKU:</label>
                <select
                  value={selectedItemCodeLedger}
                  onChange={(e) => setSelectedItemCodeLedger(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-xs"
                >
                  {products.map(p => (
                    <option key={p.itemCode} value={p.itemCode}>
                      [{p.itemCode}] {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Warehouse Selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">2. Fulfillment Center:</label>
                <select
                  value={selectedWarehouseLedger}
                  onChange={(e) => setSelectedWarehouseLedger(e.target.value)}
                  disabled={currentUserRole !== 'Super Admin'}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed shadow-xs"
                >
                  <option value="All">All Warehouses (Global Audit)</option>
                  {warehouses.map((w, idx) => (
                    <option key={`${w.id || w.code}-${idx}`} value={w.code}>
                      {w.name} ({w.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* From Date */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">3. From Date:</label>
                <input
                  type="date"
                  value={fromDateLedger}
                  onChange={(e) => setFromDateLedger(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-xs"
                />
              </div>

              {/* To Date */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">4. To Date:</label>
                <input
                  type="date"
                  value={toDateLedger}
                  onChange={(e) => setToDateLedger(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-xs"
                />
              </div>
            </div>
          </div>

          {/* Ledger Summary Bento */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-xs flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-700 rounded-lg shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[9px] text-gray-400 block uppercase font-bold">Opening Balance</span>
                <strong className="text-lg font-mono font-black text-blue-700">
                  {itemWiseLedgerData.openingBalance}
                </strong>
                <span className="text-[9px] text-gray-500 block">Units before range start</span>
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-xs flex items-center gap-3">
              <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-lg shrink-0">
                <ArrowUpRight className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[9px] text-emerald-600 block uppercase font-bold">Total Qty In (+)</span>
                <strong className="text-lg font-mono font-black text-emerald-700">
                  +{itemWiseLedgerData.totalIn}
                </strong>
                <span className="text-[9px] text-gray-500 block">Total receipts & additions</span>
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-xs flex items-center gap-3">
              <div className="p-2.5 bg-rose-50 text-rose-700 rounded-lg shrink-0">
                <ArrowDownRight className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[9px] text-rose-600 block uppercase font-bold">Total Qty Out (-)</span>
                <strong className="text-lg font-mono font-black text-rose-700">
                  -{itemWiseLedgerData.totalOut}
                </strong>
                <span className="text-[9px] text-gray-500 block">Total dispatches & issues</span>
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-xs flex items-center gap-3">
              <div className="p-2.5 bg-slate-900 text-white rounded-lg shrink-0">
                <TrendingUp className="w-5 h-5 text-indigo-400 animate-pulse" />
              </div>
              <div>
                <span className="text-[9px] text-indigo-400 block uppercase font-bold">Closing Balance</span>
                <strong className="text-lg font-mono font-black text-slate-800">
                  {itemWiseLedgerData.closingBalance}
                </strong>
                <span className="text-[9px] text-gray-500 block">Ending inventory level</span>
              </div>
            </div>
          </div>

          {/* Running Balance Ledger Table */}
          <div className="bg-white border border-gray-100 rounded-xl shadow-xs overflow-hidden">
            <div className="p-4 border-b border-gray-50 bg-gray-50/50 flex justify-between items-center">
              <h3 className="text-xs font-bold text-gray-700">Chronological Transaction List & Running Balances</h3>
              <span className="text-[10px] font-semibold text-gray-500 bg-white border border-gray-200 px-2.5 py-1 rounded-full">
                Showing {itemWiseLedgerData.ledgerRows.length} transactions
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    <th className="p-4">Timestamp</th>
                    <th className="p-4">Warehouse</th>
                    <th className="p-4">Transaction Type</th>
                    <th className="p-4">Ref Doc Number</th>
                    <th className="p-4 text-center">Qty In (Receipt)</th>
                    <th className="p-4 text-center">Qty Out (Issue)</th>
                    <th className="p-4 text-center">Running Balance</th>
                    <th className="p-4">Posted By</th>
                    <th className="p-4">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-gray-700 font-medium">
                  {/* Opening Balance Row */}
                  <tr className="bg-blue-50/20 font-bold">
                    <td className="p-4 text-[10px] text-slate-400 font-mono">Range Start</td>
                    <td className="p-4 text-slate-400">N/A</td>
                    <td className="p-4 text-blue-700 uppercase tracking-wider text-[9px] font-extrabold">Opening Balance</td>
                    <td className="p-4 text-slate-400 font-mono">-</td>
                    <td className="p-4 text-center text-slate-400 font-mono">-</td>
                    <td className="p-4 text-center text-slate-400 font-mono">-</td>
                    <td className="p-4 text-center font-mono text-indigo-700 bg-blue-50/50">{itemWiseLedgerData.openingBalance}</td>
                    <td className="p-4 text-slate-400">System</td>
                    <td className="p-4 text-[10px] text-slate-400 italic font-normal">Balance carried forward before {fromDateLedger || 'beginning'}</td>
                  </tr>

                  {itemWiseLedgerData.ledgerRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-gray-400 text-xs">
                        No transactions recorded for this SKU within the chosen parameters.
                      </td>
                    </tr>
                  ) : (
                    [...itemWiseLedgerData.ledgerRows].reverse().map((r, idx) => (
                      <tr key={r.id || idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 font-mono text-[10px] text-gray-500 whitespace-nowrap">
                          {r.date} | {r.time}
                        </td>
                        <td className="p-4 text-slate-700">
                          {r.warehouseName}
                          {r.fromWarehouseId && (
                            <div className="text-[9px] text-gray-400">
                              Transfer: {r.fromWarehouseName?.split(' (')[0]} → {r.toWarehouseName?.split(' (')[0]}
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${
                            r.transactionType.includes('Inward') || r.transactionType.includes('Add') ? 'bg-emerald-50 text-emerald-800 border-emerald-100' :
                            r.transactionType.includes('Outward') || r.transactionType.includes('Sub') || r.transactionType.includes('Damage') ? 'bg-rose-50 text-rose-800 border-rose-100' :
                            'bg-indigo-50 text-indigo-800 border-indigo-100'
                          }`}>
                            {r.transactionType}
                          </span>
                        </td>
                        <td className="p-4 font-mono text-[11px] font-bold text-gray-800 whitespace-nowrap">
                          {r.referenceNumber}
                        </td>
                        <td className="p-4 text-center font-mono text-emerald-600 font-bold">
                          {r.qtyIn ? `+${r.qtyIn}` : '-'}
                        </td>
                        <td className="p-4 text-center font-mono text-rose-600 font-bold">
                          {r.qtyOut ? `-${r.qtyOut}` : '-'}
                        </td>
                        <td className="p-4 text-center font-mono font-extrabold text-slate-900 bg-slate-50/30">
                          {r.runningBalance}
                        </td>
                        <td className="p-4 text-gray-500 font-medium">{r.user}</td>
                        <td className="p-4 text-[10px] text-gray-500 leading-normal max-w-xs truncate" title={r.remarks}>
                          {r.remarks}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'ledger' ? (
        // STOCK LEDGER VIEW
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-100 text-amber-900 rounded-xl p-4 text-[11px] flex items-start gap-2.5 leading-normal font-semibold">
            <span>🛡️</span>
            <div>
              <strong>Audit Constraint:</strong> This stock ledger is write-only, fully synchronized in real-time, and chronologically structured. 
              Editing, deleting, or altering historical transaction records is strictly prohibited to ensure financial, legal, and operational trace compliance.
            </div>
          </div>

          {/* Historical Movement Trend Line Chart */}
          {uniqueItems.length > 0 && selectedItemCode ? (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-xs p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-extrabold text-gray-950 flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-indigo-600 animate-pulse" />
                    Historical SKU Movement Velocity
                  </h3>
                  <p className="text-[10px] text-gray-500">
                    Daily velocity trends (last 30 days) for item: <span className="font-extrabold text-slate-800">{uniqueItems.find(item => item.itemCode === selectedItemCode)?.itemName || selectedItemCode}</span> (SKU: <span className="font-mono text-indigo-600 font-bold">{selectedItemCode}</span>)
                  </p>
                </div>

                {/* SKU Selector Dropdown */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">Select SKU:</span>
                  <select
                    value={selectedItemCode}
                    onChange={(e) => setSelectedItemCode(e.target.value)}
                    className="bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-xs cursor-pointer max-w-[280px]"
                  >
                    {uniqueItems.map(item => (
                      <option key={item.itemCode} value={item.itemCode}>
                        [{item.itemCode}] {item.itemName.slice(0, 30)}{item.itemName.length > 30 ? '...' : ''}{item.isDeleted ? ' (Deleted Item)' : ''}
                      </option>
                    ))}
                  </select>

                  {currentUserRole === 'Super Admin' && (
                    <button
                      onClick={async () => {
                        const targetItem = uniqueItems.find(item => item.itemCode === selectedItemCode);
                        const label = targetItem?.itemName || selectedItemCode;
                        
                        if (window.confirm(`Are you sure you want to remove item "${label}" (SKU: ${selectedItemCode}) from active product catalog?\n\nHistorical ledger entries will remain preserved in the audit log.`)) {
                          try {
                            // If exists in product catalog, delete it
                            const matchedProd = products.find(p => p.itemCode === selectedItemCode);
                            if (matchedProd && matchedProd.id) {
                              await onDeleteProduct(matchedProd.id);
                            }

                            // Run stock reconciliation
                            await onReconcileStock();

                            alert(`Successfully removed SKU "${selectedItemCode}" from active product catalog.`);
                          } catch (err: any) {
                            alert(`Failed to remove SKU: ${err.message || err}`);
                          }
                        }
                      }}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-2.5 py-1.5 rounded-xl text-[10px] flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                      title="Permanently remove this SKU and all its transaction history"
                    >
                      <Trash2 className="w-3 h-3" /> Delete Item
                    </button>
                  )}
                </div>
              </div>

              {/* Bento Grid layout with Chart and Stats summary */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* 3/4 Width Line Chart */}
                <div className="lg:col-span-3 bg-slate-50/50 rounded-2xl p-4 border border-slate-100">
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={trendData}
                        margin={{ top: 10, right: 15, left: -20, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis
                          dataKey="displayDate"
                          stroke="#94a3b8"
                          fontSize={9}
                          fontWeight={600}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          stroke="#94a3b8"
                          fontSize={9}
                          fontWeight={600}
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                        />
                        <RechartsTooltip
                          content={({ active, payload, label }: any) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="bg-slate-900 text-white p-3 rounded-xl border border-slate-800 shadow-xl text-xs font-sans">
                                  <p className="font-extrabold text-slate-300 mb-1.5">{label}</p>
                                  <div className="space-y-1">
                                    <p className="text-emerald-400 font-bold flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                                      Inward: {payload[0].value} Pcs
                                    </p>
                                    <p className="text-rose-400 font-bold flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block"></span>
                                      Outward: {payload[1].value} Pcs
                                    </p>
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Legend
                          verticalAlign="top"
                          height={36}
                          iconSize={8}
                          iconType="circle"
                          wrapperStyle={{ fontSize: '10px', fontWeight: 600, fontFamily: 'Inter' }}
                        />
                        <Line
                          name="Inward (GRN / Adjustments / Transfer In)"
                          type="monotone"
                          dataKey="Inward"
                          stroke="#10b981"
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 6, strokeWidth: 0 }}
                        />
                        <Line
                          name="Outward (Dispatches / Adjustments / Transfer Out)"
                          type="monotone"
                          dataKey="Outward"
                          stroke="#f43f5e"
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 6, strokeWidth: 0 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 1/4 Width Stats Panel */}
                <div className="space-y-3 flex flex-col justify-between">
                  <div className="bg-emerald-50/40 border border-emerald-100/50 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <span className="text-[9px] text-emerald-800/80 font-bold uppercase block">30D Inward Volume</span>
                      <span className="text-lg font-mono font-black text-emerald-700">{trendStats.totalInward}</span>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600">
                      <ArrowUpRight className="w-5 h-5" />
                    </div>
                  </div>

                  <div className="bg-rose-50/40 border border-rose-100/50 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <span className="text-[9px] text-rose-800/80 font-bold uppercase block">30D Outward Volume</span>
                      <span className="text-lg font-mono font-black text-rose-700">{trendStats.totalOutward}</span>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center text-rose-600">
                      <ArrowDownRight className="w-5 h-5" />
                    </div>
                  </div>

                  <div className={`border rounded-xl p-3 flex items-center justify-between ${
                    trendStats.netChange >= 0
                      ? 'bg-indigo-50/40 border-indigo-100/50'
                      : 'bg-amber-50/40 border-amber-100/50'
                  }`}>
                    <div>
                      <span className={`text-[9px] font-bold uppercase block ${
                        trendStats.netChange >= 0 ? 'text-indigo-800/80' : 'text-amber-800/80'
                      }`}>Net Balance Shift</span>
                      <span className={`text-lg font-mono font-black ${
                        trendStats.netChange >= 0 ? 'text-indigo-700' : 'text-amber-700'
                      }`}>
                        {trendStats.netChange >= 0 ? `+${trendStats.netChange}` : trendStats.netChange}
                      </span>
                    </div>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      trendStats.netChange >= 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'
                    }`}>
                      <TrendingUp className="w-5 h-5" />
                    </div>
                  </div>

                  <div className="bg-slate-100/80 border border-slate-200/50 rounded-xl p-3">
                    <span className="text-[8px] text-slate-500 font-extrabold uppercase tracking-wider block mb-1">Peak Day Volume</span>
                    <div className="grid grid-cols-2 gap-2 text-center text-[10px]">
                      <div className="bg-white rounded-lg p-1.5 border border-slate-100">
                        <span className="text-[8px] text-emerald-600 font-bold block">Inward</span>
                        <span className="font-mono font-extrabold text-slate-800">{trendStats.maxInward}</span>
                      </div>
                      <div className="bg-white rounded-lg p-1.5 border border-slate-100">
                        <span className="text-[8px] text-rose-600 font-bold block">Outward</span>
                        <span className="font-mono font-extrabold text-slate-800">{trendStats.maxOutward}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-xs p-8 text-center text-gray-400 text-xs">
              📊 Choose an item from the system to plot historical transaction flow over the last 30 days.
            </div>
          )}

          <div className="bg-white border border-gray-100 rounded-xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    <th className="p-4">Timestamp</th>
                    <th className="p-4">SKU / Code</th>
                    <th className="p-4">Item Name</th>
                    <th className="p-4">Fulfillment Center</th>
                    <th className="p-4 text-center">Qty Delta</th>
                    <th className="p-4">Movement Type</th>
                    <th className="p-4">Ref Doc Number</th>
                    <th className="p-4">Posted By</th>
                    <th className="p-4">Remarks</th>
                    {currentUserRole === 'Super Admin' && <th className="p-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-gray-700 font-medium">
                  {filteredMovements.length === 0 ? (
                    <tr>
                      <td colSpan={currentUserRole === 'Super Admin' ? 10 : 9} className="p-8 text-center text-gray-400 text-xs">
                        No transactions found matching your selection.
                      </td>
                    </tr>
                  ) : (
                    filteredMovements.slice().reverse().map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 font-mono text-[10px] text-gray-500 whitespace-nowrap">
                          {m.date} | {m.time}
                        </td>
                        <td className="p-4 font-mono font-bold text-indigo-700">{m.itemCode}</td>
                        <td className="p-4 text-gray-800">{m.itemName}</td>
                        <td className="p-4 text-slate-700">
                          {m.warehouseName}
                          {m.fromWarehouseId && (
                            <div className="text-[9px] text-gray-400">
                              Transfer: {m.fromWarehouseName?.split(' (')[0]} → {m.toWarehouseName?.split(' (')[0]}
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          <span className={`font-mono font-bold px-2 py-0.5 rounded ${
                            m.qty > 0 ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'
                          }`}>
                            {m.qty > 0 ? `+${m.qty}` : m.qty}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${
                            m.transactionType.includes('Inward') ? 'bg-emerald-50 text-emerald-800 border-emerald-100' :
                            m.transactionType.includes('Outward') ? 'bg-rose-50 text-rose-800 border-rose-100' :
                            'bg-indigo-50 text-indigo-800 border-indigo-100'
                          }`}>
                            {m.transactionType}
                          </span>
                        </td>
                        <td className="p-4 font-mono text-[11px] font-bold text-gray-800 whitespace-nowrap">{m.referenceNumber}</td>
                        <td className="p-4 text-gray-500 font-medium">{m.user}</td>
                        <td className="p-4 text-[10px] text-gray-500 leading-normal max-w-xs truncate" title={m.remarks}>
                          {m.remarks}
                        </td>
                        {currentUserRole === 'Super Admin' && (
                          <td className="p-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {(() => {
                                const isReversalRecord = !!m.reversalOf || m.transactionType.includes('Reversal');
                                const isReversed = movements.some(other => !!other.reversalOf && (other.reversalOf === m.id || other.reversalOf === m.referenceNumber));
                                
                                if (isReversalRecord) {
                                  return (
                                    <span className="text-[10px] text-purple-700 font-semibold px-2 py-0.5 bg-purple-50 rounded-full border border-purple-200">
                                      Reversal Entry
                                    </span>
                                  );
                                }

                                if (isReversed) {
                                  return (
                                    <span className="text-[10px] text-amber-700 font-semibold px-2 py-0.5 bg-amber-50 rounded-full border border-amber-200">
                                      Reversed
                                    </span>
                                  );
                                }

                                return (
                                  <button
                                    onClick={async () => {
                                      if (window.confirm(`Reverse Movement (${m.referenceNumber || m.id}) for ${m.itemName}?\n\nThis will create a compensating reversal entry. The original historical movement will remain unchanged.`)) {
                                        try {
                                          await onReverseMovement(m.id || '');
                                          alert(`Movement ${m.referenceNumber || m.id} successfully reversed and compensating ledger entry posted!`);
                                        } catch (e: any) {
                                          alert(`Failed to reverse movement: ${e.message || e}`);
                                        }
                                      }
                                    }}
                                    className="p-1.5 hover:bg-amber-100 text-amber-700 bg-amber-50 rounded transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-bold"
                                    title="Reverse Movement"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" /> Reverse Movement
                                  </button>
                                );
                              })()}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'audit' ? (
        // SECURITY AUDIT LOGS
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 text-slate-300 rounded-xl p-4 text-[10px] flex items-start gap-2.5 font-mono leading-relaxed">
            <span className="text-rose-400">● SYSTEM_SECURITY_MONITOR</span>
            <div>
              <strong>Secure Audit Logging Active:</strong> This list documents every single write, configuration alteration, and role transition with date, time, and active operator metadata. 
              Logs are maintained automatically by server-side Firebase triggers.
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    <th className="p-4">Date & Time</th>
                    <th className="p-4">Operator User</th>
                    <th className="p-4">Operational Action</th>
                    <th className="p-4">Module Code</th>
                    <th className="p-4">Detailed Record parameters</th>
                    {currentUserRole === 'Super Admin' && <th className="p-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-gray-700 font-medium">
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={currentUserRole === 'Super Admin' ? 6 : 5} className="p-8 text-center text-gray-400 text-xs">
                        No user activity logs matching search params.
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.slice().reverse().map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 font-mono text-[10px] text-gray-500 whitespace-nowrap">
                          {log.date} | {log.time}
                        </td>
                        <td className="p-4 font-bold text-slate-800">{log.user}</td>
                        <td className="p-4">
                          <span className="font-semibold text-gray-900">{log.action}</span>
                        </td>
                        <td className="p-4 font-mono text-[10px] text-indigo-700 bg-indigo-50/20 px-2 py-0.5 rounded max-w-min">
                          {log.module}
                        </td>
                        <td className="p-4 text-[11px] text-gray-500 font-mono leading-relaxed max-w-sm">
                          {log.details}
                        </td>
                        {currentUserRole === 'Super Admin' && (
                          <td className="p-4 text-right">
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded" title="Audit logs are append-only and cannot be modified or deleted">
                              <Shield className="w-3 h-3 text-slate-400" />
                              Immutable
                            </span>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        // BULK IMPORT LOGS
        <div className="space-y-4">
          {/* Stats Dashboard */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-xs">
              <span className="text-[10px] text-gray-400 font-extrabold uppercase block tracking-wider">Total Operations</span>
              <span className="text-2xl font-mono font-black text-slate-800">{parsedImportLogs.length}</span>
              <span className="text-[10px] text-gray-500 block mt-1">Product & Customer Files</span>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-xs">
              <span className="text-[10px] text-emerald-600 font-extrabold uppercase block tracking-wider">Success Rate</span>
              <span className="text-2xl font-mono font-black text-emerald-600">
                {parsedImportLogs.length > 0 
                  ? `${Math.round((parsedImportLogs.filter(l => l.parsed?.status === 'success').length / parsedImportLogs.length) * 100)}%`
                  : '0%'
                }
              </span>
              <span className="text-[10px] text-gray-500 block mt-1">
                {parsedImportLogs.filter(l => l.parsed?.status === 'success').length} of {parsedImportLogs.length} successful
              </span>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-xs">
              <span className="text-[10px] text-rose-600 font-extrabold uppercase block tracking-wider">Validation Blocked</span>
              <span className="text-2xl font-mono font-black text-rose-600">
                {parsedImportLogs.filter(l => l.parsed?.status === 'validation_failed').length}
              </span>
              <span className="text-[10px] text-gray-500 block mt-1">Pre-validated and locked out</span>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-xs">
              <span className="text-[10px] text-indigo-600 font-extrabold uppercase block tracking-wider">Records Inserted</span>
              <span className="text-2xl font-mono font-black text-indigo-600">
                {parsedImportLogs.reduce((sum, curr) => sum + (curr.parsed?.successCount || 0), 0)}
              </span>
              <span className="text-[10px] text-gray-500 block mt-1">Directly loaded to directory</span>
            </div>
          </div>

          {/* Table / Cards List */}
          <div className="bg-white border border-gray-100 rounded-xl shadow-xs overflow-hidden">
            <div className="p-4 border-b border-gray-50 bg-gray-50/50 flex justify-between items-center">
              <h3 className="text-xs font-bold text-gray-700">Bulk Import Audit Trail (Excel/CSV Ledger)</h3>
              <span className="text-[10px] font-semibold text-gray-500 bg-white border border-gray-200 px-2.5 py-1 rounded-full">
                Showing {filteredImportLogs.length} items
              </span>
            </div>

            <div className="divide-y divide-gray-100">
              {filteredImportLogs.length === 0 ? (
                <div className="p-12 text-center text-gray-400 text-xs font-medium">
                  No bulk import logs matching current query or search criteria.
                </div>
              ) : (
                filteredImportLogs.slice().reverse().map((log) => {
                  const p = log.parsed;
                  const isSuccess = p?.status === 'success';
                  const isExpanded = !!expandedLogIds[log.id];

                  return (
                    <div key={log.id} className="p-4 hover:bg-slate-50/30 transition-all text-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg mt-0.5 ${isSuccess ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                            <FileSpreadsheet className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-slate-800 text-xs sm:text-sm">
                                {p?.fileName || 'spreadsheet_import.xlsx'}
                              </span>
                              <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${
                                p?.importType === 'Products' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-amber-50 text-amber-700 border-amber-100'
                              }`}>
                                {p?.importType || 'General'} Type
                              </span>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                                isSuccess 
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                                  : 'bg-rose-50 text-rose-700 border border-rose-100'
                              }`}>
                                {isSuccess ? (
                                  <>
                                    <CheckCircle2 className="w-2.5 h-2.5" /> PASSED
                                  </>
                                ) : (
                                  <>
                                    <AlertTriangle className="w-2.5 h-2.5" /> BLOCKED
                                  </>
                                )}
                              </span>
                            </div>
                            <div className="text-[11px] text-gray-400 mt-1 flex items-center gap-2 flex-wrap font-medium">
                              <span>Timestamp: <strong className="font-mono text-gray-600">{log.date} {log.time}</strong></span>
                              <span>•</span>
                              <span>Operator: <strong className="text-gray-600">{log.user}</strong></span>
                              <span>•</span>
                              <span>Module: <strong className="text-gray-600">{log.module}</strong></span>
                            </div>
                          </div>
                        </div>

                        {/* Summary Pill and Action */}
                        <div className="flex items-center gap-3 sm:self-center">
                          <div className="flex gap-2 text-center">
                            <div className="px-2.5 py-1 bg-slate-50 border border-gray-100 rounded-md">
                              <span className="text-[9px] text-gray-400 block font-bold uppercase">Total Rows</span>
                              <span className="text-xs font-mono font-bold text-gray-700">{p?.totalRows || 0}</span>
                            </div>
                            <div className="px-2.5 py-1 bg-emerald-50/50 border border-emerald-100/50 rounded-md">
                              <span className="text-[9px] text-emerald-700/80 block font-bold uppercase">Imported</span>
                              <span className="text-xs font-mono font-bold text-emerald-700">{p?.successCount || 0}</span>
                            </div>
                            <div className="px-2.5 py-1 bg-slate-100/50 border border-slate-200/50 rounded-md">
                              <span className="text-[9px] text-gray-500 block font-bold uppercase">Skipped</span>
                              <span className="text-xs font-mono font-bold text-gray-600">{p?.skippedCount || 0}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            {!isSuccess && p?.errors && p.errors.length > 0 && (
                              <button
                                onClick={() => setExpandedLogIds(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                                className="p-1.5 hover:bg-gray-100 text-gray-500 rounded-lg transition-colors flex items-center gap-1 text-[10px] font-bold cursor-pointer"
                                title="Toggle Validation Errors"
                              >
                                {isExpanded ? 'Hide' : 'Errors'} 
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            )}

                            {currentUserRole === 'Super Admin' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded" title="Import audit logs are append-only">
                                <Shield className="w-3 h-3 text-slate-400" />
                                Immutable
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Expanded validation errors */}
                      {isExpanded && p?.errors && p.errors.length > 0 && (
                        <div className="mt-3 bg-rose-50/50 border border-rose-100/60 rounded-lg p-3 text-xs text-rose-800 font-medium">
                          <div className="font-bold flex items-center gap-1 text-rose-900 mb-1.5">
                            <AlertCircle className="w-3.5 h-3.5" /> File Validation Failures ({p.errors.length} detected):
                          </div>
                          <ul className="list-disc pl-5 space-y-1 font-mono text-[11px] leading-relaxed max-h-48 overflow-y-auto">
                            {p.errors.map((err: string, i: number) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
