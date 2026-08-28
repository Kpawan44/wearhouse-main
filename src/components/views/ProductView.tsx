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
  DollarSign, 
  Package,
  Upload,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { Product, UserRole, Customer, Warehouse } from '../../types';
import { Swipeable } from '../Swipeable';
import * as XLSX from 'xlsx';

interface ProductViewProps {
  products: Product[];
  customers: Customer[];
  warehouses: Warehouse[];
  onAddProduct: (prod: Omit<Product, 'id'> & { openingStock?: number; openingWarehouseId?: string }) => Promise<void>;
  onAddProductsBulk: (prods: (Omit<Product, 'id'> & { openingStock?: number; openingWarehouseId?: string })[]) => Promise<void>;
  onUpdateProduct: (prod: Product) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
  currentUserRole: UserRole;
  onLogAudit?: (action: string, module: string, details: string) => Promise<void>;
}

export const ProductView: React.FC<ProductViewProps> = ({
  products,
  customers,
  warehouses,
  onAddProduct,
  onAddProductsBulk,
  onUpdateProduct,
  onDeleteProduct,
  currentUserRole,
  onLogAudit,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Manual Form Fields
  const [itemCode, setItemCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [unit, setUnit] = useState('Pcs');
  const [hsnCode, setHsnCode] = useState('');
  const [gst, setGst] = useState(18);
  const [purchaseRate, setPurchaseRate] = useState(0);
  const [sellingRate, setSellingRate] = useState(0);
  const [minStock, setMinStock] = useState(10);
  const [maxStock, setMaxStock] = useState(100);
  const [weight, setWeight] = useState(0);
  const [image, setImage] = useState('');
  const [barcodeStatus, setBarcodeStatus] = useState<'Active' | 'Inactive'>('Active');
  const [qrCodeStatus, setQrCodeStatus] = useState<'Active' | 'Inactive'>('Active');
  const [openingStock, setOpeningStock] = useState<number>(0);
  const [openingWarehouseId, setOpeningWarehouseId] = useState<string>('');

  // Excel Bulk Import States
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importProducts, setImportProducts] = useState<Omit<Product, 'id'>[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'ready' | 'saving' | 'success' | 'error'>('idle');
  const [dragActive, setDragActive] = useState(false);
  const [importFileName, setImportFileName] = useState('');

  const isAuthorized = currentUserRole === 'Super Admin';

  const customerNames = React.useMemo(() => {
    const cats = products.map(p => p.category).filter(Boolean);
    // Include registered customers even if they don't have products yet, as suggestions
    const registeredCusts = customers.map(c => c.name);
    return ['All', ...Array.from(new Set([...cats, ...registeredCusts]))];
  }, [products, customers]);

  const openAddForm = () => {
    setEditingProduct(null);
    setItemCode(`PRD-${String(products.length + 1).padStart(3, '0')}`);
    setBarcode(String(Math.floor(100000000000 + Math.random() * 900000000000)));
    setQrCode('');
    setName('');
    setDescription('');
    setCategory(customers[0]?.name || '');
    setBrand('');
    setUnit('Pcs');
    setHsnCode('85171300');
    setGst(18);
    setPurchaseRate(0);
    setSellingRate(0);
    setMinStock(10);
    setMaxStock(100);
    setWeight(0.2);
    setImage('');
    setBarcodeStatus('Active');
    setQrCodeStatus('Active');
    setOpeningStock(0);
    const activeWh = warehouses.find(w => w.status === 'Active') || warehouses[0];
    setOpeningWarehouseId(activeWh?.id || activeWh?.code || '');
    setIsFormOpen(true);
  };

  const openEditForm = (prod: Product) => {
    setEditingProduct(prod);
    setItemCode(prod.itemCode);
    setBarcode(prod.barcode);
    setQrCode(prod.qrCode || '');
    setName(prod.name);
    setDescription(prod.description);
    setCategory(prod.category);
    setBrand(prod.brand);
    setUnit(prod.unit);
    setHsnCode(prod.hsnCode);
    setGst(prod.gst);
    setPurchaseRate(prod.purchaseRate);
    setSellingRate(prod.sellingRate);
    setMinStock(prod.minStock);
    setMaxStock(prod.maxStock);
    setWeight(prod.weight);
    setImage(prod.image || '');
    setBarcodeStatus(prod.barcodeStatus || 'Active');
    setQrCodeStatus(prod.qrCodeStatus || 'Active');
    setIsFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthorized) return;

    if (!editingProduct && openingStock > 0 && !openingWarehouseId) {
      alert("Please select a store / warehouse for the opening stock.");
      return;
    }

    const prodData: any = {
      itemCode,
      barcode,
      qrCode: qrCode || `QR_${itemCode}`,
      name,
      description,
      category: category || (customers[0]?.name || 'General Customer'),
      brand: '',
      unit,
      hsnCode,
      gst,
      purchaseRate,
      sellingRate,
      minStock: 10,
      maxStock: 100,
      weight: 0.2,
      image: '',
      barcodeStatus,
      qrCodeStatus,
    };

    if (editingProduct) {
      await onUpdateProduct({ ...prodData, id: editingProduct.id });
    } else {
      await onAddProduct({
        ...prodData,
        openingStock,
        openingWarehouseId,
      });
    }
    setIsFormOpen(false);
  };

  // Excel parser function
  const parseExcelFile = (file: File) => {
    setImportFileName(file.name);
    setImportStatus('parsing');
    setImportErrors([]);
    setImportProducts([]);

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
              'Product Catalog',
              JSON.stringify({
                type: 'bulk_import',
                fileName: file.name,
                importType: 'Products',
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
        const parsedProducts: (Omit<Product, 'id'> & { openingStock?: number; openingWarehouseId?: string })[] = [];
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

          const rawCode = getVal(['Item Code', 'SKU', 'itemCode', 'code']);
          const rawName = getVal(['Product Name', 'Name', 'productname', 'title']);
          const rawUnit = getVal(['Unit', 'UOM', 'unitofmeasure', 'unit']) || 'Pcs';
          const rawPurRate = getVal(['Purchase Rate', 'PurchaseRate', 'buyingprice', 'purchase', 'purchaseRate']);
          const rawSelRate = getVal(['Selling Rate', 'SellingRate', 'sellingprice', 'sale', 'selling', 'sellingRate']);
          const rawHsn = getVal(['HSN Code', 'HSN', 'hsncode']) || '';
          const rawGst = getVal(['GST', 'tax', 'gstpercentage', 'gst%']) || 18;
          const rawDesc = getVal(['Description', 'desc', 'details', 'itemdescription']) || '';
          const rawOpeningStock = getVal(['Opening Quantity', 'Opening Qty', 'Opening Stock', 'openingQty', 'openingStock', 'qty', 'quantity']);
          const rawStoreLocation = getVal(['Store Location', 'Warehouse', 'Location', 'openingWarehouseId', 'storeLocation', 'store']);
          const rawCustomerName = getVal(['Customer Name', 'CustomerName', 'Customer', 'category', 'customerName']);

          if (!rawCode) {
            errors.push(`Row ${rowNum}: SKU/Item Code is missing.`);
            return;
          }
          if (!rawName) {
            errors.push(`Row ${rowNum}: Product Name is missing.`);
            return;
          }

          const purRate = parseFloat(String(rawPurRate));
          if (isNaN(purRate) || purRate < 0) {
            errors.push(`Row ${rowNum} (${rawCode}): Purchase Rate is invalid or missing.`);
            return;
          }

          const selRate = parseFloat(String(rawSelRate));
          if (isNaN(selRate) || selRate < 0) {
            errors.push(`Row ${rowNum} (${rawCode}): Selling Rate is invalid or missing.`);
            return;
          }

          const gstNum = parseInt(String(rawGst));
          const finalGst = isNaN(gstNum) ? 18 : gstNum;

          // Parse initial opening stock
          let opStock = 0;
          if (rawOpeningStock !== undefined && rawOpeningStock !== null && rawOpeningStock !== '') {
            const parsedOp = parseFloat(String(rawOpeningStock));
            if (!isNaN(parsedOp) && parsedOp >= 0) {
              opStock = parsedOp;
            } else if (isNaN(parsedOp)) {
              errors.push(`Row ${rowNum} (${rawCode}): Specified Opening Quantity "${rawOpeningStock}" is not a valid number.`);
              return;
            }
          }

          // Parse store / warehouse location
          let opWhId = '';
          if (opStock > 0) {
            if (rawStoreLocation) {
              const whSearch = String(rawStoreLocation).trim().toLowerCase();
              const matchedWh = warehouses.find(w => {
                const id = (w.id || '').toLowerCase();
                const code = (w.code || '').toLowerCase();
                const name = (w.name || '').toLowerCase();
                const city = (w.city || '').toLowerCase();
                
                // Exact match
                if (id === whSearch || code === whSearch || name === whSearch || city === whSearch) {
                  return true;
                }
                
                // Fuzzy/includes matching
                if (name.includes(whSearch) || whSearch.includes(name)) {
                  return true;
                }
                
                // Specific regional mappings (e.g., "pune wearhouse", "mumbai warehouse")
                if (whSearch.includes('pune') || whSearch.includes('pun')) {
                  return id.includes('pun') || code.includes('pun') || name.includes('pune');
                }
                if (whSearch.includes('mumbai') || whSearch.includes('mum')) {
                  return id.includes('mum') || code.includes('mum') || name.includes('mumbai');
                }
                if (whSearch.includes('delhi') || whSearch.includes('del')) {
                  return id.includes('del') || code.includes('del') || name.includes('delhi');
                }
                if (whSearch.includes('bengaluru') || whSearch.includes('bangalore') || whSearch.includes('blr')) {
                  return id.includes('blr') || code.includes('blr') || name.includes('bengaluru') || name.includes('bangalore');
                }
                
                return false;
              });

              if (matchedWh) {
                opWhId = matchedWh.id || matchedWh.code;
              } else {
                errors.push(`Row ${rowNum} (${rawCode}): Store Location "${rawStoreLocation}" does not match any active warehouse code or name.`);
                return;
              }
            } else {
              errors.push(`Row ${rowNum} (${rawCode}): Opening Quantity was specified as ${opStock} but no Store Location is provided.`);
              return;
            }
          }

          // Parse Customer Name (stores in Category)
          let finalCategory = customers[0]?.name || 'General Customer';
          if (rawCustomerName) {
            const custSearch = String(rawCustomerName).trim().toLowerCase();
            const matchedCust = customers.find(c => c.name.toLowerCase() === custSearch);
            if (matchedCust) {
              finalCategory = matchedCust.name;
            } else {
              // Create dynamic client representation on the fly in the list
              finalCategory = String(rawCustomerName).trim();
            }
          }

          // Check duplicate SKU in the upload list itself
          const isDupInUpload = parsedProducts.some(p => p.itemCode.toLowerCase() === String(rawCode).trim().toLowerCase());
          if (isDupInUpload) {
            errors.push(`Row ${rowNum}: Duplicate SKU "${rawCode}" detected in the uploaded spreadsheet.`);
            return;
          }

          // Check duplicate SKU in the catalog
          const isDupInCatalog = products.some(p => p.itemCode.toLowerCase() === String(rawCode).trim().toLowerCase());

          parsedProducts.push({
            itemCode: String(rawCode).trim(),
            barcode: String(Math.floor(100000000000 + Math.random() * 900000000000)),
            qrCode: `QR_${String(rawCode).trim()}`,
            name: String(rawName).trim(),
            description: String(rawDesc).trim(),
            category: finalCategory,
            brand: '',
            unit: ['Pcs', 'Box', 'Kg', 'Set'].includes(String(rawUnit).trim()) ? String(rawUnit).trim() : 'Pcs',
            hsnCode: String(rawHsn).trim(),
            gst: finalGst,
            purchaseRate: purRate,
            sellingRate: selRate,
            minStock: 10,
            maxStock: 100,
            weight: 0.2,
            image: '',
            barcodeStatus: 'Active',
            qrCodeStatus: 'Active',
            openingStock: opStock,
            openingWarehouseId: opWhId,
            _isDuplicate: isDupInCatalog,
          } as any);
        });

        if (errors.length > 0) {
          setImportErrors(errors);
          setImportStatus('error');
          if (onLogAudit) {
            onLogAudit(
              'Bulk Import Validation Failed',
              'Product Catalog',
              JSON.stringify({
                type: 'bulk_import',
                fileName: file.name,
                importType: 'Products',
                totalRows: jsonData.length,
                successCount: 0,
                skippedCount: 0,
                status: 'validation_failed',
                errors: errors
              })
            );
          }
        } else {
          setImportProducts(parsedProducts);
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
            'Product Catalog',
            JSON.stringify({
              type: 'bulk_import',
              fileName: file.name,
              importType: 'Products',
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
          'Product Catalog',
          JSON.stringify({
            type: 'bulk_import',
            fileName: file.name,
            importType: 'Products',
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
      ['Item Code', 'Product Name', 'Unit', 'Purchase Rate', 'Selling Rate', 'HSN Code', 'GST', 'Description', 'Opening Quantity', 'Store Location', 'Customer Name'],
      ['PRD-101', 'Smartphone Premium X', 'Pcs', '45000', '59999', '85171300', '18', 'Latest 5G flagship phone with OLED display.', '100', 'WH-MUM', 'General Customer'],
      ['PRD-102', 'Wireless Earbuds Pro', 'Pcs', '2500', '4999', '85183000', '18', 'Active noise cancelling earbuds with fast charge.', '50', 'WH-MUM', 'General Customer'],
      ['PRD-103', 'Storage Carton Box Heavy', 'Box', '120', '250', '48191000', '12', 'Heavy duty shipping and storage container.', '0', '', 'General Customer']
    ];
    
    // Generate simple comma-separated-value string
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + headers.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "bulk_product_import_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkSubmit = async () => {
    if (!isAuthorized) return;
    try {
      setImportStatus('saving');
      
      const toInsert = importProducts.filter((p: any) => !p._isDuplicate);
      
      if (toInsert.length === 0) {
        const errMsg = 'No new products to import. All uploaded products already exist in the catalog.';
        setImportErrors([errMsg]);
        setImportStatus('error');
        if (onLogAudit) {
          onLogAudit(
            'Bulk Import Validation Failed',
            'Product Catalog',
            JSON.stringify({
              type: 'bulk_import',
              fileName: importFileName || 'Unknown File',
              importType: 'Products',
              totalRows: importProducts.length,
              successCount: 0,
              skippedCount: importProducts.length,
              status: 'validation_failed',
              errors: [errMsg]
            })
          );
        }
        return;
      }

      await onAddProductsBulk(toInsert);
      
      if (onLogAudit) {
        onLogAudit(
          'Bulk Import SKU Products',
          'Product Catalog',
          JSON.stringify({
            type: 'bulk_import',
            fileName: importFileName || 'Unknown File',
            importType: 'Products',
            totalRows: importProducts.length,
            successCount: toInsert.length,
            skippedCount: importProducts.length - toInsert.length,
            status: 'success',
            errors: []
          })
        );
      }

      setImportStatus('success');
      setTimeout(() => {
        setIsImportOpen(false);
        setImportProducts([]);
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
          'Product Catalog',
          JSON.stringify({
            type: 'bulk_import',
            fileName: importFileName || 'Unknown File',
            importType: 'Products',
            totalRows: importProducts.length,
            successCount: 0,
            skippedCount: importProducts.length,
            status: 'validation_failed',
            errors: [errMsg]
          })
        );
      }
    }
  };

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.barcode.includes(searchQuery);
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const duplicateCount = importProducts.filter((p: any) => p._isDuplicate).length;
  const insertCount = importProducts.length - duplicateCount;

  return (
    <div id="product-view" className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-gray-800">Global Product Catalog Master</h2>
          <p className="text-[10px] text-gray-500">Configure item descriptions, HSN codes, and tax codes</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Search SKU / Name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none w-44 shadow-xs"
          />

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none w-44 shadow-xs font-medium text-gray-700"
          >
            <option value="All">All Categories</option>
            {customerNames.filter(cat => cat !== 'All').map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

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
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Product
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
      <AnimatePresence>
        {isImportOpen && (
          <motion.div 
            initial={{ opacity: 0, height: 0, y: -15 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -15 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="overflow-hidden"
          >
            <div className="bg-white border border-emerald-100 rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div>
              <h3 className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Bulk Import Master Catalog
              </h3>
              <p className="text-[10px] text-gray-500 mt-0.5">Upload spreadsheet to import multiples items in seconds.</p>
            </div>
            <button 
              onClick={() => {
                setIsImportOpen(false);
                setImportProducts([]);
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
                <li>1. Columns must include: <strong className="text-slate-800">Item Code, Product Name, Purchase Rate, Selling Rate</strong>.</li>
                <li>2. Optional columns: <strong className="text-slate-800">Unit, HSN Code, GST, Description, Opening Quantity, Store Location, Customer Name</strong>.</li>
                <li>3. To prevent duplicate errors, items with existing SKUs will be skipped.</li>
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
                    id="excel-file-upload"
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
                    <label htmlFor="excel-file-upload" className="cursor-pointer space-y-2.5">
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
                        Found <strong className="text-slate-700">{importProducts.length}</strong> items in worksheet.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded border border-emerald-100">
                        {insertCount} New
                      </span>
                      {duplicateCount > 0 && (
                        <span className="text-[10px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded border border-amber-100" title="These items already exist in the catalog and will be ignored.">
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
                          <th className="p-2">SKU / Code</th>
                          <th className="p-2">Product Name</th>
                          <th className="p-2 text-right">Selling Rate</th>
                          <th className="p-2 text-center">Customer</th>
                          <th className="p-2 text-center">Opening Qty</th>
                          <th className="p-2 text-center">Location</th>
                          <th className="p-2 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium text-slate-600">
                        {importProducts.map((p: any, i) => (
                          <tr key={i} className="hover:bg-slate-50/50">
                            <td className="p-2 font-mono font-bold text-slate-800">{p.itemCode}</td>
                            <td className="p-2 truncate max-w-[120px]">{p.name}</td>
                            <td className="p-2 text-right font-semibold">₹{p.sellingRate}</td>
                            <td className="p-2 text-center truncate max-w-[100px]" title={p.category}>{p.category}</td>
                            <td className="p-2 text-center font-bold text-indigo-600">{p.openingStock || 0}</td>
                            <td className="p-2 text-center font-semibold text-slate-500">{p.openingWarehouseId || '-'}</td>
                            <td className="p-2 text-center">
                              {p._isDuplicate ? (
                                <span className="text-[9px] bg-amber-50 text-amber-700 font-bold px-1.5 py-0.5 rounded border border-amber-100 animate-pulse">
                                  Duplicate (Skip)
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
                        setImportProducts([]);
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
                      Import {insertCount} Items
                    </button>
                  </div>
                </div>
              ) : importStatus === 'saving' ? (
                <div className="border border-slate-100 rounded-xl p-8 bg-slate-50/50 flex flex-col items-center justify-center text-center min-h-[180px]">
                  <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin mb-3" />
                  <p className="text-xs font-extrabold text-slate-800">Writing items to cloud registry...</p>
                  <p className="text-[10px] text-slate-400 font-medium mt-0.5">Storing inventory attributes and metadata safely.</p>
                </div>
              ) : (
                // Success Import View
                <div className="border border-emerald-100 rounded-xl p-8 bg-emerald-50/30 flex flex-col items-center justify-center text-center min-h-[180px]">
                  <div className="bg-emerald-100 p-3 rounded-full text-emerald-600 mb-3 w-fit mx-auto animate-bounce">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <p className="text-xs font-extrabold text-emerald-900">Bulk Import Completed Successfully!</p>
                  <p className="text-[10px] text-emerald-700 font-semibold mt-1">Your new item catalog has been registered in real-time database.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    )}
  </AnimatePresence>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div 
            initial={{ opacity: 0, height: 0, y: -15 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -15 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="overflow-hidden"
          >
            <div className="bg-white border border-indigo-100 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
                <h3 className="font-bold text-xs text-gray-900">
                  {editingProduct ? `Edit Product Catalog [${editingProduct.itemCode}]` : 'Introduce New SKU to Catalog'}
                </h3>
                <button onClick={() => setIsFormOpen(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Row 1 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Item Code / SKU</label>
                <input
                  type="text"
                  required
                  disabled={!!editingProduct}
                  value={itemCode}
                  onChange={(e) => setItemCode(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono disabled:opacity-60"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Unit of Measure (UOM)</label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium"
                >
                  <option value="Pcs">Pcs (Pieces)</option>
                  <option value="Box">Box</option>
                  <option value="Kg">Kg (Kilograms)</option>
                  <option value="Set">Set</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Customer Name</label>
                <input
                  type="text"
                  list="customer-suggestions"
                  placeholder="Select or type customer..."
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium"
                />
                <datalist id="customer-suggestions">
                  {Array.from(new Set([
                    ...customers.map(c => c.name),
                    ...products.map(p => p.category).filter(Boolean)
                  ])).map(c => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Row 2 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-4">
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apple iPhone 15 Pro"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Row 3 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Purchase Rate (₹)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="0"
                  value={purchaseRate || ''}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '');
                    setPurchaseRate(val === '' ? 0 : parseFloat(val) || 0);
                  }}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Selling Rate (₹)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="0"
                  value={sellingRate || ''}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '');
                    setSellingRate(val === '' ? 0 : parseFloat(val) || 0);
                  }}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">HSN Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 85171300"
                  value={hsnCode}
                  onChange={(e) => setHsnCode(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">GST (%)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="18"
                  value={gst || ''}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '');
                    setGst(val === '' ? 0 : parseFloat(val) || 0);
                  }}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono"
                />
              </div>
            </div>

            {!editingProduct && (
              <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 space-y-3">
                <span className="text-[10px] font-extrabold text-slate-700 uppercase block tracking-wider">📦 Initial Opening Stock (Optional)</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Opening Stock Quantity</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={openingStock || ''}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setOpeningStock(val === '' ? 0 : parseInt(val, 10));
                      }}
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono font-bold"
                      placeholder="Enter initial stock quantity (numbers only)"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Store / Warehouse Location</label>
                    <select
                      value={openingWarehouseId}
                      onChange={(e) => setOpeningWarehouseId(e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium"
                    >
                      <option value="">-- Select Store / Warehouse --</option>
                      {warehouses.filter(w => w.status === 'Active').map(w => (
                        <option key={w.id || w.code} value={w.id || w.code}>
                          [{w.code}] {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Detailed Item Description</label>
              <textarea
                rows={2}
                placeholder="Product attributes, dimensions, storage conditions"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-50 pt-3 mt-4">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="px-3 py-1.5 border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors"
              >
                {editingProduct ? 'Update SKU Parameters' : 'Create Product SKU'}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    )}
  </AnimatePresence>

      {/* Customer Filter Pills Bar */}
      <div className="bg-white border border-gray-100 rounded-xl p-3 flex flex-wrap items-center gap-2 shadow-2xs">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider pl-1.5 mr-1 select-none">
          Customer:
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {customerNames.map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-800'
                }`}
              >
                {cat}
                {cat !== 'All' && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-[9px] rounded-md font-extrabold bg-slate-900/10 text-current">
                    {products.filter(p => p.category === cat).length}
                  </span>
                )}
                {cat === 'All' && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-[9px] rounded-md font-extrabold bg-slate-900/10 text-current">
                    {products.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid of Product Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <AnimatePresence mode="popLayout">
          {filteredProducts.map((p) => (
            <motion.div
              key={p.id || p.itemCode}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="h-full"
            >
              <Swipeable
                onSwipeLeft={isAuthorized ? () => {
                  if (window.confirm(`Are you sure you want to delete product "${p.name}"? This action cannot be undone.`)) {
                    onDeleteProduct(p.id!);
                  }
                } : undefined}
                onSwipeRight={isAuthorized ? () => openEditForm(p) : undefined}
                leftLabel="Edit"
                leftBgColor="bg-indigo-600"
                rightLabel="Delete"
                rightBgColor="bg-rose-600"
              >
                <div className="bg-white rounded-xl border border-gray-100 shadow-xs overflow-hidden hover:shadow-md hover:border-indigo-100 transition-all flex flex-col justify-between h-full">
                  <div>
                    {/* Card Body */}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-1 mb-1.5">
                        <span className="text-[10px] font-bold text-indigo-600 font-mono bg-indigo-50 px-2 py-0.5 rounded">{p.itemCode}</span>
                        <span className="text-[10px] text-gray-500 font-semibold font-mono">{p.unit}</span>
                      </div>

                      <h3 className="font-extrabold text-xs text-gray-800 leading-tight truncate mt-1">{p.name}</h3>
                      <p className="text-[10px] text-gray-500 leading-normal mt-1.5 line-clamp-2 h-7">{p.description}</p>

                      {/* Rates & Codes */}
                      <div className="mt-3 grid grid-cols-2 gap-3 bg-gray-50/50 rounded-lg p-2.5 border border-gray-100 text-[10px]">
                        <div>
                          <span className="text-gray-400 font-medium block">Purchase Rate</span>
                          <strong className="text-gray-800 font-semibold">₹{p.purchaseRate}</strong>
                        </div>
                        <div>
                          <span className="text-gray-400 font-medium block">Selling Rate</span>
                          <strong className="text-indigo-600 font-extrabold">₹{p.sellingRate}</strong>
                        </div>
                      </div>

                      {/* Specifications */}
                      <div className="mt-3 space-y-2 text-[10px] text-gray-500 border-t border-gray-50 pt-2.5">
                        <div className="flex justify-between">
                          <span>HSN/GST:</span>
                          <strong className="font-mono text-gray-700 font-medium">{p.hsnCode} / {p.gst}%</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Customer Name:</span>
                          <strong className="text-indigo-600 font-extrabold truncate max-w-[120px]" title={p.category}>{p.category || 'N/A'}</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  {isAuthorized && (
                    <div className="px-4 pb-4 border-t border-gray-50 pt-3 flex justify-end gap-2">
                      <button
                        onClick={() => openEditForm(p)}
                        className="p-1.5 text-gray-400 hover:text-indigo-600 bg-gray-50 rounded-md transition-colors cursor-pointer"
                        title="Edit Product"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Are you sure you want to delete product "${p.name}"? This action cannot be undone.`)) {
                            onDeleteProduct(p.id!);
                          }
                        }}
                        className="p-1.5 text-gray-400 hover:text-rose-600 bg-gray-50 rounded-md transition-colors cursor-pointer"
                        title="Delete Product"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </Swipeable>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
