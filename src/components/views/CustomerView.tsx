import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Edit3, 
  Trash2, 
  ShieldAlert, 
  Check, 
  X, 
  Search, 
  Info, 
  Phone, 
  Mail, 
  FileText, 
  MapPin, 
  User, 
  Star,
  Upload,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { Customer, UserRole } from '../../types';
import { Swipeable } from '../Swipeable';
import * as XLSX from 'xlsx';

interface CustomerViewProps {
  customers: Customer[];
  onAddCustomer: (cust: Omit<Customer, 'id'>) => Promise<void>;
  onAddCustomersBulk: (custs: Omit<Customer, 'id'>[]) => Promise<void>;
  onUpdateCustomer: (cust: Customer) => Promise<void>;
  onDeleteCustomer: (id: string) => Promise<void>;
  currentUserRole: UserRole;
  onLogAudit?: (action: string, module: string, details: string) => Promise<void>;
}

export const CustomerView: React.FC<CustomerViewProps> = ({
  customers,
  onAddCustomer,
  onAddCustomersBulk,
  onUpdateCustomer,
  onDeleteCustomer,
  currentUserRole,
  onLogAudit,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Form Fields
  const [name, setName] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Excel Bulk Import States
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importCustomers, setImportCustomers] = useState<(Omit<Customer, 'id'> & { _isDuplicate?: boolean })[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'ready' | 'saving' | 'success' | 'error'>('idle');
  const [dragActive, setDragActive] = useState(false);
  const [importFileName, setImportFileName] = useState('');

  const isAuthorized = currentUserRole === 'Super Admin';

  const openAddForm = () => {
    setEditingCustomer(null);
    setName('');
    setGstNumber('');
    setAddress('');
    setPhone('');
    setEmail('');
    setIsFormOpen(true);
  };

  const openEditForm = (cust: Customer) => {
    setEditingCustomer(cust);
    setName(cust.name);
    setGstNumber(cust.gstNumber);
    setAddress(cust.address);
    setPhone(cust.phone);
    setEmail(cust.email);
    setIsFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthorized) return;

    const customerData = {
      name: name.trim(),
      gstNumber: gstNumber.trim().toUpperCase(),
      address: address.trim(),
      phone: phone.trim(),
      email: email.trim(),
    };

    try {
      if (editingCustomer) {
        await onUpdateCustomer({ ...customerData, id: editingCustomer.id });
      } else {
        await onAddCustomer(customerData);
      }
      setIsFormOpen(false);
    } catch (err) {
      console.error('Error saving customer:', err);
      alert('Failed to save customer record. Please try again.');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!isAuthorized) return;
    if (window.confirm(`Are you sure you want to permanently delete customer "${name}"?`)) {
      try {
        await onDeleteCustomer(id);
      } catch (err) {
        console.error('Error deleting customer:', err);
        alert('Failed to delete customer record.');
      }
    }
  };

  // Excel parser function for customers
  const parseExcelFile = (file: File) => {
    setImportFileName(file.name);
    setImportStatus('parsing');
    setImportErrors([]);
    setImportCustomers([]);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("Could not read file data");

        // read file
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert sheet to json
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);
        
        if (jsonData.length === 0) {
          const errMsg = 'The uploaded file is empty or contains no readable rows.';
          setImportErrors([errMsg]);
          setImportStatus('error');
          if (onLogAudit) {
            onLogAudit(
              'Bulk Import Validation Failed',
              'Masters Settings',
              JSON.stringify({
                type: 'bulk_import',
                fileName: file.name,
                importType: 'Customers',
                totalRows: 0,
                successCount: 0,
                skippedCount: 0,
                status: 'validation_failed',
                errors: [errMsg]
              })
            );
          }
          return;
        }

        // Process rows
        const parsedCustomers: (Omit<Customer, 'id'> & { _isDuplicate?: boolean })[] = [];
        const errors: string[] = [];

        jsonData.forEach((row, idx) => {
          const rowNum = idx + 2; // header is row 1
          
          // Case-insensitive key matching helper
          const getVal = (possibleKeys: string[]) => {
            for (const k of possibleKeys) {
              if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
                return row[k];
              }
              // Normalised lowercase match
              const normalizedK = k.toLowerCase().replace(/\s+/g, '');
              for (const actualKey of Object.keys(row)) {
                const normalizedActual = actualKey.toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
                if (normalizedActual === normalizedK || normalizedActual.includes(normalizedK)) {
                  return row[actualKey];
                }
              }
            }
            return undefined;
          };

          const rawName = getVal(['Customer Name', 'Client Name', 'Name', 'Company', 'Customer']);
          const rawGst = getVal(['GSTIN Number', 'GST Number', 'GSTIN', 'GST', 'Tax Registration', 'gstNumber', 'gstin']) || '';
          const rawAddress = getVal(['Billing & Delivery Address', 'Address', 'Shipping Address', 'Billing Address', 'Location', 'address']) || '';
          const rawPhone = getVal(['Phone Contact', 'Phone', 'Telephone', 'Mobile', 'Contact', 'phone']) || '';
          const rawEmail = getVal(['Email Contact', 'Email', 'Mail', 'email']) || '';

          if (!rawName) {
            errors.push(`Row ${rowNum}: Customer Name is missing.`);
            return;
          }

          // Check duplicate name in the upload list itself
          const isDupInUpload = parsedCustomers.some(c => c.name.toLowerCase() === String(rawName).trim().toLowerCase());
          if (isDupInUpload) {
            errors.push(`Row ${rowNum}: Duplicate Customer Name "${rawName}" detected in the uploaded spreadsheet.`);
            return;
          }

          // Check duplicate Name or GSTIN in the current database catalog
          const nameLower = String(rawName).trim().toLowerCase();
          const gstUpper = String(rawGst).trim().toUpperCase();
          const isDupInCatalog = customers.some(c => {
            const isNameDup = c.name.toLowerCase() === nameLower;
            const isGstDup = gstUpper && c.gstNumber && c.gstNumber.toUpperCase() === gstUpper;
            return isNameDup || isGstDup;
          });

          parsedCustomers.push({
            name: String(rawName).trim(),
            gstNumber: gstUpper,
            address: String(rawAddress).trim(),
            phone: String(rawPhone).trim(),
            email: String(rawEmail).trim(),
            _isDuplicate: isDupInCatalog,
          });
        });

        if (errors.length > 0) {
          setImportErrors(errors);
          setImportStatus('error');
          if (onLogAudit) {
            onLogAudit(
              'Bulk Import Validation Failed',
              'Masters Settings',
              JSON.stringify({
                type: 'bulk_import',
                fileName: file.name,
                importType: 'Customers',
                totalRows: jsonData.length,
                successCount: 0,
                skippedCount: 0,
                status: 'validation_failed',
                errors: errors
              })
            );
          }
        } else {
          setImportCustomers(parsedCustomers);
          setImportStatus('ready');
        }
      } catch (err: any) {
        console.error("Error parsing Excel/CSV spreadsheet:", err);
        const errMsg = `Failed to parse file: ${err.message || 'Unknown structure error'}`;
        setImportErrors([errMsg]);
        setImportStatus('error');
        if (onLogAudit) {
          onLogAudit(
            'Bulk Import Validation Failed',
            'Masters Settings',
            JSON.stringify({
              type: 'bulk_import',
              fileName: file.name,
              importType: 'Customers',
              totalRows: 0,
              successCount: 0,
              skippedCount: 0,
              status: 'validation_failed',
              errors: [errMsg]
            })
          );
        }
      }
    };

    reader.onerror = () => {
      const errMsg = 'Error reading file. Please make sure the file is not corrupted.';
      setImportErrors([errMsg]);
      setImportStatus('error');
      if (onLogAudit) {
        onLogAudit(
          'Bulk Import Validation Failed',
          'Masters Settings',
          JSON.stringify({
            type: 'bulk_import',
            fileName: file.name,
            importType: 'Customers',
            totalRows: 0,
            successCount: 0,
            skippedCount: 0,
            status: 'validation_failed',
            errors: [errMsg]
          })
        );
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      parseExcelFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      parseExcelFile(e.target.files[0]);
    }
  };

  const downloadTemplate = () => {
    const headers = [
      ['Customer Name', 'GSTIN Number', 'Phone Contact', 'Email Contact', 'Billing & Delivery Address'],
      ['Croma Retail Ltd', '27AAACC1234A1Z1', '+91 98765 43210', 'receiving@croma.com', 'Regus Hub, Level 2, Bandra West, Mumbai, Maharashtra 400050'],
      ['Reliance Digital Outlets', '27BBBCC2345B2Z2', '+91 98111 22222', 'billing@reliance.com', 'Corporate Park, Sector 4, Kopar Khairane, Navi Mumbai, Maharashtra 400710'],
      ['Local Tech Distributors', '', '+91 98999 88888', 'localtech@gmail.com', 'Shop 12, Nehru Place, New Delhi 110019']
    ];
    
    // Generate simple comma-separated-value string
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + headers.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "bulk_customer_import_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkSubmit = async () => {
    if (!isAuthorized) return;
    try {
      setImportStatus('saving');
      
      const toInsert = importCustomers.filter((c) => !c._isDuplicate);
      
      if (toInsert.length === 0) {
        const errMsg = 'No new customers to import. All uploaded customers already exist in the directory.';
        setImportErrors([errMsg]);
        setImportStatus('error');
        if (onLogAudit) {
          onLogAudit(
            'Bulk Import Validation Failed',
            'Masters Settings',
            JSON.stringify({
              type: 'bulk_import',
              fileName: importFileName || 'Unknown File',
              importType: 'Customers',
              totalRows: importCustomers.length,
              successCount: 0,
              skippedCount: importCustomers.length,
              status: 'validation_failed',
              errors: [errMsg]
            })
          );
        }
        return;
      }

      await onAddCustomersBulk(toInsert);
      
      if (onLogAudit) {
        onLogAudit(
          'Bulk Import Customers',
          'Masters Settings',
          JSON.stringify({
            type: 'bulk_import',
            fileName: importFileName || 'Unknown File',
            importType: 'Customers',
            totalRows: importCustomers.length,
            successCount: toInsert.length,
            skippedCount: importCustomers.length - toInsert.length,
            status: 'success',
            errors: []
          })
        );
      }

      setImportStatus('success');
      setTimeout(() => {
        setIsImportOpen(false);
        setImportCustomers([]);
        setImportStatus('idle');
      }, 3000);

    } catch (err: any) {
      console.error(err);
      const errMsg = `Import failed: ${err.message || 'Firestore server timeout.'}`;
      setImportErrors([errMsg]);
      setImportStatus('error');
      if (onLogAudit) {
        onLogAudit(
          'Bulk Import Validation Failed',
          'Masters Settings',
          JSON.stringify({
            type: 'bulk_import',
            fileName: importFileName || 'Unknown File',
            importType: 'Customers',
            totalRows: importCustomers.length,
            successCount: 0,
            skippedCount: importCustomers.length,
            status: 'validation_failed',
            errors: [errMsg]
          })
        );
      }
    }
  };

  const filteredCustomers = customers.filter((cust) => {
    const query = searchQuery.toLowerCase();
    return (
      cust.name.toLowerCase().includes(query) ||
      cust.gstNumber.toLowerCase().includes(query) ||
      cust.phone.includes(query) ||
      cust.email.toLowerCase().includes(query)
    );
  });

  const duplicateCount = importCustomers.filter((c) => c._isDuplicate).length;
  const insertCount = importCustomers.length - duplicateCount;

  return (
    <div id="customer-view" className="space-y-6 animate-fade-in font-sans">
      {/* Header and Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-gray-800">Customer Master Directory</h2>
          <p className="text-[10px] text-gray-500">Configure corporate accounts, client shipping destinations, and GSTIN profiles</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-400" />
            <input
              type="text"
              placeholder="Search customer, GSTIN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none w-48 shadow-xs"
            />
          </div>

          {isAuthorized ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setIsImportOpen(!isImportOpen);
                  setIsFormOpen(false);
                }}
                className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors animate-fade-in"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Import Excel/CSV
              </button>

              <button
                onClick={() => {
                  openAddForm();
                  setIsImportOpen(false);
                }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-all shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Customer</span>
              </button>
            </div>
          ) : (
            <span className="text-[10px] bg-amber-50 text-amber-700 font-bold px-2 py-1.5 rounded-md border border-amber-100 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              Super Admin lock
            </span>
          )}
        </div>
      </div>

      {/* Excel / CSV Bulk Import Component */}
      {isImportOpen && (
        <div className="bg-white border border-emerald-100 rounded-xl p-5 shadow-xs animate-scale-up space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div>
              <h3 className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Bulk Import Customer Accounts
              </h3>
              <p className="text-[10px] text-gray-500 mt-0.5">Upload spreadsheet to import multiple customer master accounts instantly.</p>
            </div>
            <button 
              onClick={() => {
                setIsImportOpen(false);
                setImportCustomers([]);
                setImportErrors([]);
                setImportStatus('idle');
              }} 
              className="text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Action Header / Guidelines */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1 bg-slate-50 border border-slate-100 p-4 rounded-xl space-y-3">
              <h4 className="text-[10px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-indigo-500" />
                Instructions
              </h4>
              <ul className="text-[11px] text-slate-500 font-medium space-y-2 leading-relaxed">
                <li>1. Spreadsheet MUST include a <strong className="text-slate-800">Customer Name</strong> column.</li>
                <li>2. Optional columns: <strong className="text-slate-800">GSTIN Number, Phone Contact, Email Contact, Billing & Delivery Address</strong>.</li>
                <li>3. Pre-existing Customer Names or GSTIN numbers will be highlighted and safely skipped to avoid duplicate profile overhead.</li>
              </ul>
              <button
                onClick={downloadTemplate}
                className="w-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                Download CSV Template
              </button>
            </div>

            {/* Drag and Drop Zone / File Input */}
            <div className="md:col-span-2">
              {importStatus === 'idle' || importStatus === 'parsing' || importStatus === 'error' ? (
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all min-h-[180px] ${
                    dragActive 
                      ? 'border-emerald-500 bg-emerald-50/50 scale-98' 
                      : 'border-slate-200 hover:border-emerald-400 hover:bg-slate-50/30'
                  }`}
                >
                  <input
                    type="file"
                    id="excel-customer-file-upload"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  
                  {importStatus === 'parsing' ? (
                    <div className="space-y-2">
                      <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin mx-auto" />
                      <p className="text-xs font-bold text-slate-700">Analyzing template structure...</p>
                    </div>
                  ) : (
                    <label htmlFor="excel-customer-file-upload" className="cursor-pointer space-y-2.5">
                      <div className="bg-emerald-50 p-3 rounded-full w-fit mx-auto text-emerald-600">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-xs font-extrabold text-slate-800">
                          Click to upload or drag & drop spreadsheet
                        </p>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                          Supports Excel (.xlsx, .xls) and standard CSV files
                        </p>
                      </div>
                    </label>
                  )}

                  {importStatus === 'error' && importErrors.length > 0 && (
                    <div className="mt-4 bg-rose-50 border border-rose-100 rounded-lg p-3 max-w-md text-left text-[11px] text-rose-700 space-y-1 font-semibold max-h-[100px] overflow-y-auto">
                      <div className="flex items-center gap-1.5 text-xs text-rose-800 font-bold mb-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        Spreadsheet Verification Failure
                      </div>
                      {importErrors.map((err, i) => (
                        <div key={i} className="pl-5 relative">
                          <span className="absolute left-0">•</span> {err}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : importStatus === 'ready' ? (
                // Success Parse Preview
                <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/50 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white border border-slate-100 rounded-lg p-3">
                    <div>
                      <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        Spreadsheet Loaded Successfully
                      </h4>
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                        Found <strong className="text-slate-700">{importCustomers.length}</strong> accounts in worksheet.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded border border-emerald-100">
                        {insertCount} New
                      </span>
                      {duplicateCount > 0 && (
                        <span className="text-[10px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded border border-amber-100" title="These accounts already exist (by name or GSTIN) and will be ignored.">
                          {duplicateCount} Skipped (Exists)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Micro Table Preview */}
                  <div className="max-h-[140px] overflow-auto border border-slate-200 rounded-lg bg-white">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead className="bg-slate-50 text-slate-400 font-bold tracking-wider sticky top-0 uppercase text-[9px] border-b border-slate-200">
                        <tr>
                          <th className="p-2">Customer / Client Name</th>
                          <th className="p-2">GSTIN Number</th>
                          <th className="p-2 text-right">Phone Contact</th>
                          <th className="p-2 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium text-slate-600">
                        {importCustomers.map((c, i) => (
                          <tr key={i} className="hover:bg-slate-50/50">
                            <td className="p-2 font-bold text-slate-800 truncate max-w-[150px]">{c.name}</td>
                            <td className="p-2 font-mono">{c.gstNumber || '—'}</td>
                            <td className="p-2 text-right font-mono">{c.phone || '—'}</td>
                            <td className="p-2 text-center">
                              {c._isDuplicate ? (
                                <span className="text-[9px] bg-amber-50 text-amber-700 font-bold px-1.5 py-0.5 rounded border border-amber-100 animate-pulse">
                                  Exists (Skip)
                                </span>
                              ) : (
                                <span className="text-[9px] bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded border border-emerald-100">
                                  Valid
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => {
                        setImportCustomers([]);
                        setImportStatus('idle');
                      }}
                      className="px-3 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Clear File
                    </button>
                    <button
                      onClick={handleBulkSubmit}
                      disabled={insertCount === 0}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors shadow-xs flex items-center gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      Import {insertCount} Accounts
                    </button>
                  </div>
                </div>
              ) : importStatus === 'saving' ? (
                <div className="border border-slate-100 rounded-xl p-8 bg-slate-50/50 flex flex-col items-center justify-center text-center min-h-[180px]">
                  <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin mb-3" />
                  <p className="text-xs font-extrabold text-slate-800">Writing client registry to cloud directory...</p>
                  <p className="text-[10px] text-slate-400 font-medium mt-0.5">Storing account coordinates and shipping paths safely.</p>
                </div>
              ) : (
                // Success Import View
                <div className="border border-emerald-100 rounded-xl p-8 bg-emerald-50/30 flex flex-col items-center justify-center text-center min-h-[180px]">
                  <div className="bg-emerald-100 p-3 rounded-full text-emerald-600 mb-3 w-fit mx-auto animate-bounce">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <p className="text-xs font-extrabold text-emerald-900">Bulk Import Completed Successfully!</p>
                  <p className="text-[10px] text-emerald-700 font-semibold mt-1">Your client accounts directory has been synchronized in real-time database.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Analytics Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4 shadow-xs">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
            <User className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider">Total Registrations</span>
            <span className="text-lg font-black text-gray-800">{customers.length}</span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4 shadow-xs">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Star className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider">Active Outlets</span>
            <span className="text-lg font-black text-gray-800">
              {customers.filter(c => c.gstNumber).length} Active GSTINs
            </span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4 shadow-xs">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider">Regional Spread</span>
            <span className="text-lg font-black text-gray-800">
              {Array.from(new Set(customers.map(c => c.address.split(',').pop()?.trim()).filter(Boolean))).length || 1} States
            </span>
          </div>
        </div>
      </div>

      {/* Mobile Card List (Touch-Friendly Swipe) */}
      <div className="block md:hidden space-y-4">
        {filteredCustomers.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-xs">
            <Info className="w-5 h-5 mx-auto mb-2 text-gray-300" />
            <span>No customer profiles found matching filters.</span>
          </div>
        ) : (
          filteredCustomers.map((cust) => (
            <Swipeable
              key={cust.id}
              onSwipeLeft={isAuthorized ? () => cust.id && handleDelete(cust.id, cust.name) : undefined}
              onSwipeRight={isAuthorized ? () => openEditForm(cust) : undefined}
              leftLabel="Edit"
              leftBgColor="bg-indigo-600"
              rightLabel="Delete"
              rightBgColor="bg-rose-600"
            >
              <div className="bg-white rounded-xl border border-gray-150 p-4 shadow-2xs space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-extrabold text-xs border border-slate-200 shrink-0">
                    {cust.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-gray-900 block truncate text-xs">{cust.name}</span>
                    <span className="text-[9px] text-gray-400 block font-mono">ID: {cust.id?.substring(0, 8)}...</span>
                  </div>
                  {cust.gstNumber && (
                    <span className="font-mono bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[8px] font-bold border border-indigo-100 shrink-0">
                      {cust.gstNumber}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-600 pt-2 border-t border-slate-50">
                  {cust.phone && (
                    <div className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-gray-400 shrink-0" />
                      <span className="truncate">{cust.phone}</span>
                    </div>
                  )}
                  {cust.email && (
                    <div className="flex items-center gap-1 col-span-1">
                      <Mail className="w-3 h-3 text-gray-400 shrink-0" />
                      <span className="truncate">{cust.email}</span>
                    </div>
                  )}
                  {cust.address && (
                    <div className="flex items-start gap-1 col-span-2 mt-1">
                      <MapPin className="w-3 h-3 text-gray-400 shrink-0 mt-0.5" />
                      <span className="leading-tight line-clamp-1">{cust.address}</span>
                    </div>
                  )}
                </div>

                {isAuthorized && (
                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-50">
                    <button
                      onClick={() => openEditForm(cust)}
                      className="px-2.5 py-1 text-[10px] font-bold text-slate-500 hover:text-indigo-600 bg-slate-50 rounded-md border border-slate-100 flex items-center gap-1"
                    >
                      <Edit3 className="w-3 h-3" /> Edit
                    </button>
                    <button
                      onClick={() => cust.id && handleDelete(cust.id, cust.name)}
                      className="px-2.5 py-1 text-[10px] font-bold text-slate-400 hover:text-rose-600 bg-slate-50 rounded-md border border-slate-100 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                )}
              </div>
            </Swipeable>
          ))
        )}
      </div>

      {/* Main Grid / Directory Table (Desktop-Only) */}
      <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/75 border-b border-gray-200 text-gray-400 uppercase font-mono text-[9px] tracking-wider">
                <th className="px-6 py-3.5 font-bold">Client Name</th>
                <th className="px-6 py-3.5 font-bold">GSTIN Profile</th>
                <th className="px-6 py-3.5 font-bold">Phone Connection</th>
                <th className="px-6 py-3.5 font-bold">Corporate Email</th>
                <th className="px-6 py-3.5 font-bold">Delivery Address</th>
                {isAuthorized && <th className="px-6 py-3.5 font-bold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs text-gray-600 font-medium">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={isAuthorized ? 6 : 5} className="text-center py-12 text-gray-400">
                    <Info className="w-5 h-5 mx-auto mb-2 text-gray-300" />
                    <span>No customer profiles found matching filters.</span>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((cust) => (
                  <tr key={cust.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-[10px] border border-slate-200">
                          {cust.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-bold text-gray-900 block">{cust.name}</span>
                          <span className="text-[9px] text-gray-400 block font-mono">ID: {cust.id?.substring(0, 8)}...</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {cust.gstNumber ? (
                        <span className="font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold border border-indigo-100">
                          {cust.gstNumber}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400 italic">Not Registered</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-gray-700">
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-gray-400" />
                        <span>{cust.phone || '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-700">
                      <div className="flex items-center gap-1.5">
                        <Mail className="w-3 h-3 text-gray-400" />
                        <span>{cust.email || '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-500 max-w-xs truncate" title={cust.address}>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="truncate">{cust.address || '—'}</span>
                      </div>
                    </td>
                    {isAuthorized && (
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEditForm(cust)}
                            className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors cursor-pointer"
                            title="Edit customer account"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => cust.id && handleDelete(cust.id, cust.name)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                            title="Delete customer record"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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

      {/* Form Slide-over/Modal */}
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
              className="w-full max-w-lg max-h-[calc(100vh-4rem)] bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="bg-slate-950 text-white px-6 py-4 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-indigo-400">
                    {editingCustomer ? 'Update Customer Profile' : 'Register New Customer Account'}
                  </h3>
                  <p className="text-[10px] text-gray-400 mt-0.5">Define unique tax credentials and delivery endpoints</p>
                </div>
                <button
                  onClick={() => setIsFormOpen(false)}
                  className="text-gray-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Customer Name *</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Reliance Retail Outlets"
                      className="w-full bg-slate-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-semibold text-gray-800"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">GSTIN Tax Registration Number</label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      maxLength={15}
                      value={gstNumber}
                      onChange={(e) => setGstNumber(e.target.value)}
                      placeholder="e.g. 27CCCCC3333C3Z3"
                      className="w-full bg-slate-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono font-bold text-gray-800"
                    />
                  </div>
                  <p className="text-[9px] text-gray-400">Provide 15-digit state code format.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Phone Contact</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="e.g. +91 98333 44444"
                        className="w-full bg-slate-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Email Contact</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="e.g. receiving@croma.com"
                        className="w-full bg-slate-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Billing & Delivery Address</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <textarea
                      rows={3}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Complete corporate office or regional hub address detail"
                      className="w-full bg-slate-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-gray-800 resize-none"
                    />
                  </div>
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
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 py-2 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-all shadow-xs"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{editingCustomer ? 'Update Profile' : 'Register Account'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
