import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Edit3, Trash2, ShieldAlert, Check, X, MapPin, Phone, User } from 'lucide-react';
import { Warehouse, UserRole } from '../../types';
import { Swipeable } from '../Swipeable';

interface WarehouseViewProps {
  warehouses: Warehouse[];
  onAddWarehouse: (wh: Omit<Warehouse, 'id'>) => Promise<void>;
  onUpdateWarehouse: (wh: Warehouse) => Promise<void>;
  onDeleteWarehouse: (id: string) => Promise<void>;
  currentUserRole: UserRole;
}

export const WarehouseView: React.FC<WarehouseViewProps> = ({
  warehouses,
  onAddWarehouse,
  onUpdateWarehouse,
  onDeleteWarehouse,
  currentUserRole,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingWh, setEditingWh] = useState<Warehouse | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Form state
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'Active' | 'Inactive'>('Active');
  const [isPrimary, setIsPrimary] = useState(false);

  const isAuthorized = currentUserRole === 'Super Admin';

  const openAddForm = () => {
    setEditingWh(null);
    setCode(`WH-${String(warehouses.length + 1).padStart(3, '0')}`);
    setName('');
    setAddress('');
    setCity('');
    setState('');
    setContactPerson('');
    setPhone('');
    setStatus('Active');
    setIsPrimary(false);
    setIsFormOpen(true);
  };

  const openEditForm = (wh: Warehouse) => {
    setEditingWh(wh);
    setCode(wh.code);
    setName(wh.name);
    setAddress(wh.address);
    setCity(wh.city);
    setState(wh.state);
    setContactPerson(wh.contactPerson);
    setPhone(wh.phone);
    setStatus(wh.status);
    setIsPrimary(wh.isPrimary ?? false);
    setIsFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthorized) return;

    const whData = {
      code,
      name,
      address,
      city,
      state,
      contactPerson,
      phone,
      status,
      isPrimary,
    };

    if (editingWh) {
      await onUpdateWarehouse({ ...whData, id: editingWh.id });
    } else {
      await onAddWarehouse(whData);
    }
    setIsFormOpen(false);
  };

  const filteredWarehouses = warehouses.filter(wh =>
    wh.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    wh.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    wh.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div id="warehouse-view" className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-gray-800">Warehouse Master Directory</h2>
          <p className="text-[10px] text-gray-500">Configure logistics centers and physical warehouse locations</p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search warehouse..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none w-48 shadow-xs"
          />
          {isAuthorized ? (
            <button
              onClick={openAddForm}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Warehouse
            </button>
          ) : (
            <span className="text-[10px] bg-amber-50 text-amber-700 font-bold px-2 py-1.5 rounded-md border border-amber-100 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              Super Admin required to edit
            </span>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div 
            initial={{ opacity: 0, height: 0, y: -15 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -15 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="overflow-hidden mb-4"
          >
            <div className="bg-white border border-indigo-100 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
                <h3 className="font-bold text-xs text-gray-900">
                  {editingWh ? `Edit Warehouse [${editingWh.code}]` : 'Add New Physical Warehouse'}
                </h3>
                <button onClick={() => setIsFormOpen(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Warehouse Code</label>
                <input
                  type="text"
                  required
                  disabled={!!editingWh}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono disabled:opacity-60"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Warehouse Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Central Warehouse"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'Active' | 'Inactive')}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Warehouse Type</label>
                <select
                  value={isPrimary ? 'Primary' : 'Secondary'}
                  onChange={(e) => setIsPrimary(e.target.value === 'Primary')}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-medium text-indigo-600 font-bold"
                >
                  <option value="Secondary">Secondary Warehouse</option>
                  <option value="Primary">⭐ Primary (Supplier)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Full Address</label>
                <input
                  type="text"
                  required
                  placeholder="Street, Industrial Area"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">City</label>
                  <input
                    type="text"
                    required
                    placeholder="City"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">State</label>
                  <input
                    type="text"
                    required
                    placeholder="State"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Contact Person Name</label>
                <input
                  type="text"
                  required
                  placeholder="Full name"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Phone Number</label>
                <input
                  type="text"
                  required
                  placeholder="+91 XXXXX XXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
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
                {editingWh ? 'Update Details' : 'Save Warehouse'}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    )}
  </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {filteredWarehouses.map((wh) => (
          <Swipeable
            key={wh.id}
            onSwipeLeft={isAuthorized ? () => {
              if (window.confirm(`Are you sure you want to delete warehouse "${wh.name}"? This action cannot be undone.`)) {
                onDeleteWarehouse(wh.id);
              }
            } : undefined}
            onSwipeRight={isAuthorized ? () => openEditForm(wh) : undefined}
            leftLabel="Edit"
            leftBgColor="bg-indigo-600"
            rightLabel="Delete"
            rightBgColor="bg-rose-600"
          >
            <div className={`bg-white rounded-xl border p-5 flex flex-col justify-between hover:shadow-md transition-all h-full ${
              wh.isPrimary ? 'border-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.12)] bg-amber-50/5' : 'border-gray-100 shadow-xs'
            }`}>
              <div>
                <div className="flex items-center justify-between border-b border-gray-50 pb-3 mb-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-indigo-600 font-mono tracking-wider bg-indigo-50 px-2 py-0.5 rounded-full">
                      {wh.code}
                    </span>
                    {wh.isPrimary ? (
                      <span className="text-[9px] font-bold text-amber-700 bg-amber-100/60 border border-amber-200 px-1.5 py-0.5 rounded-md">
                        ★ Primary (Supplier)
                      </span>
                    ) : (
                      <span className="text-[9px] font-semibold text-gray-500 bg-gray-50 border border-gray-150 px-1.5 py-0.5 rounded-md">
                        Secondary
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    wh.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {wh.status}
                  </span>
                </div>

                <h3 className="font-extrabold text-sm text-gray-800 mb-2 truncate">{wh.name}</h3>
                
                <div className="space-y-2 text-xs text-gray-600 mt-3 font-medium">
                  <div className="flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
                    <span className="leading-tight text-[11px]">
                      {wh.address}, {wh.city}, {wh.state}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="text-[11px]">{wh.contactPerson} (Manager)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="text-[11px]">{wh.phone}</span>
                  </div>
                </div>
              </div>

              {isAuthorized && (
                <div className="mt-5 pt-3 border-t border-gray-50 flex justify-end gap-2">
                  <button
                    onClick={() => openEditForm(wh)}
                    className="p-1.5 text-gray-400 hover:text-indigo-600 bg-gray-50 rounded-md transition-colors cursor-pointer"
                    title="Edit Warehouse"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Are you sure you want to delete warehouse "${wh.name}"? This action cannot be undone.`)) {
                        onDeleteWarehouse(wh.id);
                      }
                    }}
                    className="p-1.5 text-gray-400 hover:text-rose-600 bg-gray-50 rounded-md transition-colors cursor-pointer"
                    title="Delete Warehouse"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </Swipeable>
        ))}
      </div>
    </div>
  );
};
