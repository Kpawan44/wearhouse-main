import React, { useState, useEffect } from 'react';
import { ShieldCheck, Save, RefreshCw, KeyRound, CheckCircle2, AlertTriangle, Users, Trash2, Mail, Building, Search, UserCheck, Sun, Moon, Edit, Check, X, Phone, Smartphone } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db, getDoc } from '../../firebase';
import { UserRole, User, Warehouse } from '../../types';
import { ThemeToggle } from '../ThemeToggle';

interface SettingsViewProps {
  currentUserRole: UserRole;
  currentUserName: string;
  currentUserUid?: string;
  users?: User[];
  warehouses?: Warehouse[];
  onRemoveUser?: (uid: string, name: string, email: string) => Promise<void>;
  onUpdateUser?: (uid: string, name: string, role: UserRole, warehouseId: string, phone?: string, status?: 'Active' | 'Disabled') => Promise<void>;
  onLogAudit: (action: string, module: string, details: string) => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: (theme: 'light' | 'dark') => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentUserRole,
  currentUserName,
  currentUserUid = '',
  users = [],
  warehouses = [],
  onRemoveUser,
  onUpdateUser,
  onLogAudit,
  theme = 'light',
  onToggleTheme,
}) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Notification Alerts & Phone Alignment States
  const [inwardPhone, setInwardPhone] = useState<string>('');
  const [inwardContact, setInwardContact] = useState<string>('');
  const [outwardPhone, setOutwardPhone] = useState<string>('');
  const [outwardContact, setOutwardContact] = useState<string>('');
  const [transferPhone, setTransferPhone] = useState<string>('');
  const [transferContact, setTransferContact] = useState<string>('');
  const [adjustmentPhone, setAdjustmentPhone] = useState<string>('');
  const [adjustmentContact, setAdjustmentContact] = useState<string>('');
  
  const [isAlertsSaving, setIsAlertsSaving] = useState<boolean>(false);
  const [alertsSuccess, setAlertsSuccess] = useState<string>('');
  const [alertsError, setAlertsError] = useState<string>('');

  // User list states
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');
  const [removingUserId, setRemovingUserId] = useState<string>('');
  const [userActionSuccess, setUserActionSuccess] = useState<string>('');
  const [userActionError, setUserActionError] = useState<string>('');

  // User profile editing states
  const [editingUserId, setEditingUserId] = useState<string>('');
  const [editingName, setEditingName] = useState<string>('');
  const [editingRole, setEditingRole] = useState<UserRole>('Store Operator');
  const [editingWarehouseId, setEditingWarehouseId] = useState<string>('');
  const [editingPhone, setEditingPhone] = useState<string>('');
  const [editingStatus, setEditingStatus] = useState<'Active' | 'Disabled'>('Active');

  const handleStartEditUser = (user: User) => {
    setEditingUserId(user.uid);
    setEditingName(user.name || '');
    setEditingRole(user.role || 'Store Operator');
    setEditingWarehouseId(user.warehouseId || '');
    setEditingPhone(user.phone || '');
    setEditingStatus(user.status || 'Active');
    setUserActionSuccess('');
    setUserActionError('');
  };

  const handleSaveUser = async (uid: string) => {
    if (!editingName.trim()) {
      setUserActionError('Full Name cannot be empty.');
      return;
    }

    try {
      setIsSaving(true);
      setUserActionSuccess('');
      setUserActionError('');
      const targetUser = users.find(u => u.uid === uid);
      const finalRole: UserRole = targetUser?.email?.toLowerCase() === 'chinarsales737@gmail.com'
        ? 'Super Admin'
        : (editingRole === 'Super Admin' ? 'Store Operator' : editingRole);

      if (onUpdateUser) {
        await onUpdateUser(uid, editingName.trim(), finalRole, editingWarehouseId, editingPhone.trim(), editingStatus);
        setUserActionSuccess(`Successfully updated profile details for operator "${editingName}".`);
        setEditingUserId('');
      } else {
        throw new Error('User profile update callback is not configured.');
      }
    } catch (err: any) {
      console.error("Failed to update user:", err);
      setUserActionError(`Failed to update user profile: ${err.message || 'Unknown network error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleUserStatus = async (user: User) => {
    const newStatus = user.status === 'Disabled' ? 'Active' : 'Disabled';
    
    if (user.uid === currentUserUid) {
      setUserActionError('Safety Lock active: You cannot disable your own active account.');
      return;
    }

    try {
      setIsSaving(true);
      setUserActionSuccess('');
      setUserActionError('');
      if (onUpdateUser) {
        await onUpdateUser(
          user.uid,
          user.name || 'User',
          user.role || 'Store Operator',
          user.warehouseId || '',
          user.phone,
          newStatus
        );
        setUserActionSuccess(`User "${user.name}" status changed to ${newStatus}.`);
      }
    } catch (err: any) {
      console.error("Failed to toggle status:", err);
      setUserActionError(`Failed to change status: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveUserClick = async (uid: string, name: string, email: string) => {
    setUserActionSuccess('');
    setUserActionError('');

    // Safety lock: Cannot remove yourself
    if (uid === currentUserUid || email === currentUserName || name === currentUserName) {
      setUserActionError('Safety Lock active: You cannot remove your own active terminal session profile.');
      return;
    }

    if (!window.confirm(`Are you sure you want to permanently revoke system access for operator "${name}" (${email})? This will immediately lock their profile.`)) {
      return;
    }

    try {
      setRemovingUserId(uid);
      if (onRemoveUser) {
        await onRemoveUser(uid, name, email);
        setUserActionSuccess(`Successfully revoked access and deleted profile for "${name}".`);
      } else {
        throw new Error('User removal callback is not configured.');
      }
    } catch (err: any) {
      console.error("Failed to remove user:", err);
      setUserActionError(`Failed to remove user profile: ${err.message || 'Unknown network error'}`);
    } finally {
      setRemovingUserId('');
    }
  };

  const handlePurgeOtherUsers = async () => {
    if (!window.confirm("Are you sure you want to permanently revoke system access for ALL other users in the database? This action is irreversible.")) {
      return;
    }

    setUserActionSuccess('');
    setUserActionError('');
    setIsSaving(true);

    try {
      let purgedCount = 0;
      for (const u of users) {
        const isSelf = u.uid === currentUserUid || u.name === currentUserName;
        if (!isSelf && onRemoveUser) {
          await onRemoveUser(u.uid, u.name || 'Anonymous Operator', u.email || '');
          purgedCount++;
        }
      }
      onLogAudit("Purged All Other Users", "Access Gatekeeper", `Admin initiated bulk purge. Revoked ${purgedCount} user profiles.`);
      setUserActionSuccess(`Successfully purged ${purgedCount} other user profiles from the system database.`);
    } catch (err: any) {
      console.error("Failed to purge other users:", err);
      setUserActionError(`Bulk purge failed: ${err.message || 'Unknown network error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Fetch alerts configuration on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setIsLoading(true);
        
        // Fetch alert alignments
        const alertsRef = doc(db, 'settings', 'alerts_alignment');
        const alertsSnap = await getDoc(alertsRef);
        if (alertsSnap.exists()) {
          const data = alertsSnap.data();
          if (data) {
            setInwardPhone(data.inwardPhone || '');
            setInwardContact(data.inwardContact || '');
            setOutwardPhone(data.outwardPhone || '');
            setOutwardContact(data.outwardContact || '');
            setTransferPhone(data.transferPhone || '');
            setTransferContact(data.transferContact || '');
            setAdjustmentPhone(data.adjustmentPhone || '');
            setAdjustmentContact(data.adjustmentContact || '');
          }
        }
      } catch (err: any) {
        console.error("Failed to load admin settings:", err);
      } finally {
        setIsLoading(false);
      }
    };

    if (currentUserRole === 'Super Admin') {
      fetchSettings();
    }
  }, [currentUserRole]);

  const handleUpdateAlerts = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertsError('');
    setAlertsSuccess('');
    setIsAlertsSaving(true);
    try {
      const docRef = doc(db, 'settings', 'alerts_alignment');
      await setDoc(docRef, {
        inwardPhone: inwardPhone.trim(),
        inwardContact: inwardContact.trim(),
        outwardPhone: outwardPhone.trim(),
        outwardContact: outwardContact.trim(),
        transferPhone: transferPhone.trim(),
        transferContact: transferContact.trim(),
        adjustmentPhone: adjustmentPhone.trim(),
        adjustmentContact: adjustmentContact.trim(),
        updatedAt: new Date().toISOString(),
        updatedBy: currentUserName,
      }, { merge: true });

      setAlertsSuccess('Alert phone numbers successfully aligned and saved in the cloud registry.');
      onLogAudit(
        'Alert Contacts Aligned',
        'System Settings',
        `Configured transition alerts contact alignment: Inward GRN: ${inwardContact} (${inwardPhone}), Outward Customer: ${outwardContact} (${outwardPhone}), Stock Transfer: ${transferContact} (${transferPhone}), Inventory Adjustment: ${adjustmentContact} (${adjustmentPhone})`
      );
    } catch (err: any) {
      console.error("Error saving alerts alignment:", err);
      setAlertsError(`Failed to save alignments: ${err.message || 'Unknown network error'}`);
    } finally {
      setIsAlertsSaving(false);
    }
  };

  if (currentUserRole !== 'Super Admin') {
    return (
      <div id="settings-view-unauthorized" className="p-8 text-center bg-white rounded-xl border border-rose-100 shadow-xs max-w-lg mx-auto mt-12">
        <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
        <h3 className="text-base font-extrabold text-slate-900 mb-1">Access Restrict Violation</h3>
        <p className="text-xs text-slate-500 font-semibold">
          Only Super Administrator profiles are authorized to access and modify terminal system configurations.
        </p>
      </div>
    );
  }

  return (
    <div id="settings-view" className="space-y-6 max-w-3xl mx-auto animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-indigo-600" />
            System Settings & Security Policies
          </h1>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            Configure system-wide registry variables, access passcode mandates, and authentication parameters.
          </p>
        </div>
      </div>

      {/* Info Status Board */}
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 border border-indigo-900 rounded-xl p-5 text-slate-100 shadow-lg relative overflow-hidden">
        <div className="absolute right-0 bottom-0 translate-y-1/4 translate-x-1/4 opacity-10">
          <ShieldCheck className="w-48 h-48" />
        </div>
        <span className="text-[10px] font-black text-indigo-400 tracking-wider block uppercase mb-1">SECURITY CONTEXT SUMMARY</span>
        <div>
          <strong className="text-base font-extrabold block">Role-Based Access Terminal Active</strong>
          <p className="text-xs text-slate-400 font-medium max-w-xl mt-1">
            Access privileges, transactions, and system configuration modifications are strictly enforced based on authenticated Firestore user profile roles.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Side Instruction Cards */}
        <div className="md:col-span-1 space-y-4">
          {/* Interface Theme Toggle Card */}
          <div className="bg-white dark:bg-slate-950 border border-gray-100 dark:border-slate-800 p-5 rounded-xl shadow-xs">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sun className="w-4 h-4 text-amber-500" />
              Interface Theme
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mb-4">
              Toggle between standard Light mode or high-contrast eye-safe Dark mode for the terminal interface.
            </p>
            <ThemeToggle
              theme={theme}
              onToggleTheme={(t) => onToggleTheme && onToggleTheme(t)}
              variant="segmented"
            />
          </div>
        </div>

        {/* Notification Alerts & Phone Alignment Setup Card */}
        <div className="md:col-span-2">
          <form onSubmit={handleUpdateAlerts} className="bg-white border border-gray-100 rounded-xl shadow-xs overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Phone className="w-4 h-4 text-emerald-600" />
                  Alert Contacts & Phone Alignment Setup
                </h2>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Assign designated phone numbers and contact names to receive notifications for specific transaction flows.
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {alertsError && (
                <div className="bg-rose-50 border border-rose-100 text-rose-700 p-3.5 rounded-lg text-xs font-semibold flex items-start gap-2 animate-pulse">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{alertsError}</span>
                </div>
              )}

              {alertsSuccess && (
                <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 p-3.5 rounded-lg text-xs font-semibold flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                  <span>{alertsSuccess}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 1. Inward GRN Alerts */}
                <div className="bg-slate-50/50 p-4 rounded-xl border border-gray-100 space-y-3">
                  <h3 className="text-[10px] font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    Inward GRN Alerts
                  </h3>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Recipient Contact Person</label>
                      <input
                        type="text"
                        placeholder="e.g. Rajesh Sharma"
                        value={inwardContact}
                        onChange={(e) => setInwardContact(e.target.value)}
                        disabled={isAlertsSaving}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Recipient Phone Number</label>
                      <input
                        type="tel"
                        placeholder="e.g. +91 98765 43210"
                        value={inwardPhone}
                        onChange={(e) => setInwardPhone(e.target.value)}
                        disabled={isAlertsSaving}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Outward Dispatch Alerts */}
                <div className="bg-slate-50/50 p-4 rounded-xl border border-gray-100 space-y-3">
                  <h3 className="text-[10px] font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-500" />
                    Outward Dispatch Alerts
                  </h3>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Recipient Contact Person</label>
                      <input
                        type="text"
                        placeholder="e.g. Vikram Singh"
                        value={outwardContact}
                        onChange={(e) => setOutwardContact(e.target.value)}
                        disabled={isAlertsSaving}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Recipient Phone Number</label>
                      <input
                        type="tel"
                        placeholder="e.g. +91 99887 76655"
                        value={outwardPhone}
                        onChange={(e) => setOutwardPhone(e.target.value)}
                        disabled={isAlertsSaving}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Stock Transfer Alerts */}
                <div className="bg-slate-50/50 p-4 rounded-xl border border-gray-100 space-y-3">
                  <h3 className="text-[10px] font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    Inter-Warehouse Transfer Alerts
                  </h3>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Recipient Contact Person</label>
                      <input
                        type="text"
                        placeholder="e.g. Anita Rao"
                        value={transferContact}
                        onChange={(e) => setTransferContact(e.target.value)}
                        disabled={isAlertsSaving}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Recipient Phone Number</label>
                      <input
                        type="tel"
                        placeholder="e.g. +91 97766 55443"
                        value={transferPhone}
                        onChange={(e) => setTransferPhone(e.target.value)}
                        disabled={isAlertsSaving}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                {/* 4. Stock Adjustment Alerts */}
                <div className="bg-slate-50/50 p-4 rounded-xl border border-gray-100 space-y-3">
                  <h3 className="text-[10px] font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    Stock Adjustment Alerts
                  </h3>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Recipient Contact Person</label>
                      <input
                        type="text"
                        placeholder="e.g. Audit Manager"
                        value={adjustmentContact}
                        onChange={(e) => setAdjustmentContact(e.target.value)}
                        disabled={isAlertsSaving}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Recipient Phone Number</label>
                      <input
                        type="tel"
                        placeholder="e.g. +91 95544 33221"
                        value={adjustmentPhone}
                        onChange={(e) => setAdjustmentPhone(e.target.value)}
                        disabled={isAlertsSaving}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t border-gray-100 flex items-center justify-end">
              <button
                type="submit"
                disabled={isAlertsSaving}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs disabled:opacity-50"
              >
                {isAlertsSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Saving Alignments...
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    Save Alignments
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* System User Directory & Access Management Section */}
      {(() => {
        const filteredUsers = users.filter((u) => {
          const queryStr = userSearchQuery.toLowerCase().trim();
          if (!queryStr) return true;
          return (
            (u.name || '').toLowerCase().includes(queryStr) ||
            (u.email || '').toLowerCase().includes(queryStr) ||
            (u.role || '').toLowerCase().includes(queryStr) ||
            (u.warehouseId || '').toLowerCase().includes(queryStr)
          );
        });

        return (
          <div className="bg-white border border-gray-100 rounded-xl shadow-xs overflow-hidden mt-6">
            <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-indigo-600" />
                  System User Directory & Access Management
                </h2>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Review active operators, administrators, and guest viewers. Revoke profile access immediately to block rogue logins.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 max-w-md w-full sm:w-auto">
                <div className="relative w-full sm:w-64">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-3.5 w-3.5 text-gray-400" />
                  </span>
                  <input
                    type="text"
                    placeholder="Search name, email, or role..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    className="w-full bg-slate-50 border border-gray-200 rounded-lg pl-9 pr-3 py-1.5 text-xs focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                  />
                </div>
                {currentUserRole === 'Super Admin' && (
                  <button
                    type="button"
                    onClick={handlePurgeOtherUsers}
                    disabled={isSaving}
                    className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-sm"
                    title="Permanently remove all other users except yourself"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Purge All Others
                  </button>
                )}
              </div>
            </div>

            <div className="p-5 space-y-4">
              {userActionError && (
                <div className="bg-rose-50 border border-rose-100 text-rose-700 p-3.5 rounded-lg text-xs font-semibold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{userActionError}</span>
                </div>
              )}

              {userActionSuccess && (
                <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 p-3.5 rounded-lg text-xs font-semibold flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                  <span>{userActionSuccess}</span>
                </div>
              )}

              {filteredUsers.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-xs font-medium bg-slate-50 rounded-lg border border-dashed border-gray-200">
                  No matching user profiles found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-100 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">
                        <th className="pb-3 pl-2">User Profile</th>
                        <th className="pb-3">Security Role</th>
                        <th className="pb-3">Assigned Location</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3 text-right pr-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-xs">
                      {filteredUsers.map((user) => {
                        const isActiveUser = user.uid === currentUserUid || user.email === currentUserName || user.name === currentUserName;
                        const isEditing = editingUserId === user.uid;
                        return (
                          <tr key={user.uid} className={`hover:bg-slate-50/50 transition-colors ${isEditing ? 'bg-indigo-50/20' : ''}`}>
                            <td className="py-3.5 pl-2">
                              {isEditing ? (
                                <div className="space-y-1.5 max-w-[200px]">
                                  <input
                                    type="text"
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    placeholder="Operator Name"
                                    className="w-full bg-white border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-semibold text-slate-800"
                                  />
                                  <input
                                    type="tel"
                                    value={editingPhone}
                                    onChange={(e) => setEditingPhone(e.target.value)}
                                    placeholder="Alert Phone (e.g. +91 9876543210)"
                                    className="w-full bg-white border border-gray-200 rounded px-2.5 py-1 text-[11px] focus:ring-1 focus:ring-indigo-500 focus:outline-none font-semibold text-slate-800"
                                  />
                                  <div className="text-[10px] text-gray-400 font-mono italic px-1">
                                    {user.email || 'N/A'}
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-700 font-bold text-xs uppercase shrink-0">
                                    {user.name ? user.name.slice(0, 2) : 'OP'}
                                  </div>
                                  <div>
                                    <div className="font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
                                      {user.name || 'Anonymous User'}
                                      {isActiveUser && (
                                        <span className="bg-indigo-100 text-indigo-700 text-[9px] font-extrabold px-1.5 py-0.5 rounded-sm uppercase tracking-wider flex items-center gap-0.5">
                                          <UserCheck className="w-2.5 h-2.5" />
                                          Active Session
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-gray-400 font-medium flex items-center gap-1 mt-0.5">
                                      <Mail className="w-3 h-3 text-gray-400" />
                                      {user.email || 'N/A'}
                                    </div>
                                    {user.phone && (
                                      <div className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 mt-0.5">
                                        <Smartphone className="w-3 h-3 text-emerald-500 shrink-0" />
                                        {user.phone}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="py-3.5">
                                {isEditing ? (
                                  <select
                                    value={editingRole}
                                    onChange={(e) => setEditingRole(e.target.value as UserRole)}
                                    className="bg-white border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-semibold text-slate-800"
                                  >
                                    {user.email?.toLowerCase() === 'chinarsales737@gmail.com' ? (
                                      <option value="Super Admin">Super Admin (Primary)</option>
                                    ) : (
                                      <>
                                        <option value="Store Operator">Store Operator</option>
                                        <option value="Viewer">Viewer</option>
                                      </>
                                    )}
                                  </select>
                              ) : (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${
                                  user.role === 'Super Admin' 
                                    ? 'bg-purple-100 text-purple-700' 
                                    : user.role === 'Store Operator' 
                                    ? 'bg-blue-100 text-blue-700' 
                                    : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {user.role}
                                </span>
                              )}
                            </td>
                            <td className="py-3.5">
                              {isEditing ? (
                                <select
                                  value={editingWarehouseId}
                                  onChange={(e) => setEditingWarehouseId(e.target.value)}
                                  className="bg-white border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-semibold text-slate-800 max-w-[180px]"
                                >
                                  <option value="">Global / All Stores</option>
                                  {warehouses.map((wh, idx) => (
                                    <option key={`${wh.id || wh.code}-${idx}`} value={wh.code}>
                                      {wh.name} ({wh.code})
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="flex items-center gap-1 text-slate-600 font-semibold">
                                  <Building className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                  {(() => {
                                    if (!user.warehouseId) return 'Global / All Stores';
                                    const wh = warehouses.find(w => w.code === user.warehouseId || w.id === user.warehouseId);
                                    return wh ? `${wh.name} (${wh.code})` : user.warehouseId;
                                  })()}
                                </div>
                              )}
                            </td>
                            <td className="py-3.5">
                              {isEditing ? (
                                <select
                                  value={editingStatus}
                                  onChange={(e) => setEditingStatus(e.target.value as 'Active' | 'Disabled')}
                                  className="bg-white border border-gray-200 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-semibold text-slate-800"
                                >
                                  <option value="Active">Active</option>
                                  <option value="Disabled">Disabled</option>
                                </select>
                              ) : (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${
                                  user.status === 'Disabled'
                                    ? 'bg-rose-100 text-rose-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                  {user.status || 'Active'}
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 text-right pr-2">
                              {isEditing ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleSaveUser(user.uid)}
                                    disabled={isSaving}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-1.5 rounded-lg text-xs flex items-center justify-center cursor-pointer transition-colors"
                                    title="Save Profile Updates"
                                  >
                                    {isSaving ? (
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <button
                                    onClick={() => setEditingUserId('')}
                                    disabled={isSaving}
                                    className="bg-gray-100 hover:bg-gray-200 text-gray-600 dark:text-gray-400 font-bold p-1.5 rounded-lg text-xs flex items-center justify-center cursor-pointer transition-colors border border-gray-200"
                                    title="Cancel"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleToggleUserStatus(user)}
                                    disabled={isSaving || isActiveUser}
                                    className={`px-2 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
                                      user.status === 'Disabled'
                                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                                        : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                                    } ${isActiveUser ? 'opacity-40 cursor-not-allowed' : ''}`}
                                    title={isActiveUser ? "Cannot disable your own session" : (user.status === 'Disabled' ? "Activate Account" : "Disable Account")}
                                  >
                                    {user.status === 'Disabled' ? 'Enable' : 'Disable'}
                                  </button>
                                  <button
                                    onClick={() => handleStartEditUser(user)}
                                    disabled={isSaving || removingUserId === user.uid}
                                    className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-bold px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1 cursor-pointer transition-all border border-indigo-100"
                                    title="Edit User Profile"
                                  >
                                    <Edit className="w-3.5 h-3.5" />
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleRemoveUserClick(user.uid, user.name, user.email)}
                                    disabled={removingUserId === user.uid || isActiveUser || isSaving}
                                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                      isActiveUser
                                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                        : 'bg-rose-50 text-rose-600 hover:bg-rose-100 active:bg-rose-200'
                                    }`}
                                    title={isActiveUser ? "Cannot delete yourself while logged in" : "Remove user from system"}
                                  >
                                    {removingUserId === user.uid ? (
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="w-3.5 h-3.5" />
                                    )}
                                    Remove User
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
