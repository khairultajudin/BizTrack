import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { Modal } from '../components/ui/Modal';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import { Plus, Edit2, Trash2, Receipt, AlertCircle, Search, Loader2, Building2 } from 'lucide-react';
import { EmptyState } from '../core/ui/EmptyState';
import { formatCurrency } from '../lib/currency';
import { filterVisibleExpenses, unwrapSupabaseQuery } from '../lib/dashboardFetch';
import {
  buildExpensesContextKey,
  executeExpensesFetch,
  executeReconcilePaymentOptionsFetch,
  executeReconcileSave,
} from '../lib/expensesFetch';

interface Expense {
  id: string;
  branch_id?: string | null;
  date: string;
  category: string;
  description: string;
  amount: number;
  salary_reconciliation_status?: string | null;
  staff_payment_id?: string | null;
}

interface UnresolvedSalaryExpense {
  id: string;
  business_id: string;
  branch_id: string | null;
  branch_name: string | null;
  date: string;
  category: string;
  description: string;
  amount: number;
  salary_reconciliation_status: string;
  staff_payment_id: string | null;
}

interface StaffPaymentOption {
  id: string;
  branch_id: string | null;
  amount: number;
  date: string;
  month: string;
  year: number;
  staff_name?: string | null;
}

export const Expenses: React.FC = () => {
  const { t } = useTemplate();
  const { user, businessId, isSalaryAuthorized } = useAuth();
  const userId = user?.id ?? null;
  const { branches, selectedBranchId, isMultiBranch, isStaff } = useBranch();
  
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [entityToDelete, setEntityToDelete] = useState<{id: string, name: string} | null>(null);
  const [unresolvedSalaryExpenses, setUnresolvedSalaryExpenses] = useState<UnresolvedSalaryExpense[]>([]);
  const [reconcileModalOpen, setReconcileModalOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<UnresolvedSalaryExpense | null>(null);
  const [reconcileAction, setReconcileAction] = useState<'linked_duplicate' | 'standalone' | 'unresolved'>('standalone');
  const [selectedStaffPaymentId, setSelectedStaffPaymentId] = useState<string>('');
  const [staffPaymentOptions, setStaffPaymentOptions] = useState<StaffPaymentOption[]>([]);
  const [reconcileConfirming, setReconcileConfirming] = useState(false);
  const [reconcileSubmitting, setReconcileSubmitting] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const fetchSeqRef = useRef(0);
  const reconcileOptionsSeqRef = useRef(0);

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0], 
    category: 'Rental', 
    description: '', 
    amount: 0,
    branch_id: ''
  });

  const categories = isSalaryAuthorized
    ? ['Rental', 'Utilities', 'Internet', 'Marketing', 'Salary', 'Equipment', 'Transport', 'Others']
    : ['Rental', 'Utilities', 'Internet', 'Marketing', 'Equipment', 'Transport', 'Others'];

  const currentContextKey = buildExpensesContextKey(
    userId,
    businessId,
    selectedBranchId,
    isSalaryAuthorized
  );
  const hasCurrentContextData = Boolean(
    currentContextKey && loadedContextKey === currentContextKey
  );
  const visibleExpenses = hasCurrentContextData ? expenses : [];
  const visibleUnresolvedSalaryExpenses =
    hasCurrentContextData && isSalaryAuthorized ? unresolvedSalaryExpenses : [];

  const fetchData = useCallback(async () => {
    await executeExpensesFetch<Expense, UnresolvedSalaryExpense>({
      seqRef: fetchSeqRef,
      userId,
      businessId,
      selectedBranchId,
      isSalaryAuthorized,
      callbacks: {
        setLoading,
        setError: setLoadError,
        setLoadedContextKey,
        setExpenses,
        setUnresolvedSalaryExpenses,
      },
      loadExpenses: async () => {
        if (!userId || !businessId) {
          return { expenses: [], unresolvedSalaryExpenses: [] };
        }

        let query = supabase
          .from('expenses')
          .select('*')
          .eq('business_id', businessId)
          .order('date', { ascending: false });

        if (selectedBranchId) {
          query = query.eq('branch_id', selectedBranchId);
        }

        const expensesResult = await query;
        const { data: rawExpenses } = unwrapSupabaseQuery<Expense[]>(
          expensesResult,
          'expenses'
        );
        const filtered = filterVisibleExpenses(rawExpenses || [], isSalaryAuthorized);

        if (!isSalaryAuthorized) {
          return {
            expenses: filtered,
            unresolvedSalaryExpenses: [],
          };
        }

        const unresolvedResult = await supabase.rpc('get_unresolved_salary_expenses', {
          p_business_id: businessId,
          p_branch_id: selectedBranchId || null,
        });
        const { data: unresolvedRows } = unwrapSupabaseQuery<UnresolvedSalaryExpense[]>(
          unresolvedResult,
          'unresolved salary expenses'
        );

        return {
          expenses: filtered,
          unresolvedSalaryExpenses: Array.isArray(unresolvedRows) ? unresolvedRows : [],
        };
      },
    });
  }, [userId, businessId, selectedBranchId, isSalaryAuthorized]);

  const openReconcileModal = async (expense?: UnresolvedSalaryExpense) => {
    if (!isSalaryAuthorized || !userId || !businessId) return;
    const target = expense || visibleUnresolvedSalaryExpenses[0] || null;
    setSelectedExpense(target);
    setReconcileAction('standalone');
    setSelectedStaffPaymentId('');
    setReconcileConfirming(false);
    setReconcileModalOpen(true);

    await executeReconcilePaymentOptionsFetch<StaffPaymentOption>({
      seqRef: reconcileOptionsSeqRef,
      expenseId: target?.id,
      callbacks: {
        setError: setReconcileError,
        setOptions: setStaffPaymentOptions,
      },
      loadOptions: async () => {
        const payRes = await supabase.rpc('get_reconcilable_staff_payments', {
          p_business_id: businessId,
          p_branch_id: target?.branch_id || null,
        });
        const { data: payRows } = unwrapSupabaseQuery<StaffPaymentOption[]>(
          payRes,
          'teacher payment records'
        );
        return Array.isArray(payRows) ? payRows : [];
      },
    });
  };

  const handleReconcileSave = async () => {
    await executeReconcileSave({
      isSalaryAuthorized,
      userId,
      businessId,
      selectedExpenseId: selectedExpense?.id,
      reconcileAction,
      selectedStaffPaymentId,
      callbacks: {
        setSubmitting: setReconcileSubmitting,
        setError: setReconcileError,
        setConfirming: setReconcileConfirming,
        setModalOpen: setReconcileModalOpen,
        clearSelectedExpense: () => setSelectedExpense(null),
      },
      saveReconcile: async () => {
        const { error } = await supabase.rpc('reconcile_salary_expense', {
          p_business_id: businessId,
          p_expense_id: selectedExpense?.id,
          p_new_status: reconcileAction,
          p_staff_payment_id: reconcileAction === 'linked_duplicate' ? selectedStaffPaymentId : null,
        });
        return { error };
      },
      onSuccess: fetchData,
    });
  };

  useEffect(() => {
    void fetchData();
    return () => {
      fetchSeqRef.current += 1;
      reconcileOptionsSeqRef.current += 1;
    };
  }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!businessId) {
      setFormError('Workspace context missing. Please refresh the page and try again.');
      return;
    }

    const descTrimmed = formData.description.trim();
    if (!descTrimmed) {
      setFormError('Expense description is required.');
      return;
    }

    const resolvedBranchId = isMultiBranch ? (formData.branch_id || selectedBranchId || branches[0]?.id || null) : null;
    if (isMultiBranch && !resolvedBranchId) {
      setFormError('Please select a branch for this expense.');
      return;
    }

    setSubmitting(true);

    const payload: Record<string, any> = {
      date: formData.date,
      category: formData.category || 'Rental',
      description: descTrimmed,
      amount: isNaN(Number(formData.amount)) ? 0 : Number(formData.amount),
      business_id: businessId,
      ...(isMultiBranch ? { branch_id: resolvedBranchId } : {})
    };

    try {
      let saveError: any = null;

      if (editingId) {
        const { error } = await supabase
          .from('expenses')
          .update(payload)
          .eq('id', editingId)
          .eq('business_id', businessId);
        saveError = error;
      } else {
        const { error } = await supabase
          .from('expenses')
          .insert([payload]);
        saveError = error;
      }

      if (saveError) {
        console.error('Supabase error saving expense:', {
          message: saveError.message,
          details: saveError.details,
          hint: saveError.hint,
          code: saveError.code,
          fullError: saveError
        });
        setFormError(saveError.message || 'Unable to save expense record. Please check your input.');
        setSubmitting(false);
        return; // DO NOT close modal on error
      }

      setSubmitting(false);
      setIsModalOpen(false);
      fetchData();
    } catch (err: any) {
      console.error('Unexpected error in handleSubmit:', err);
      setFormError(err.message || 'An unexpected error occurred while saving.');
      setSubmitting(false);
    }
  };

  const handleEdit = (expense: Expense) => {
    setFormError(null);
    setFormData({
      date: expense.date,
      category: expense.category,
      description: expense.description || '',
      amount: expense.amount,
      branch_id: expense.branch_id || selectedBranchId || (branches[0]?.id || '')
    });
    setEditingId(expense.id);
    setIsModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!businessId || !entityToDelete) return;
    const { error } = await supabase.from('expenses')
      .delete()
      .eq('id', entityToDelete.id)
      .eq('business_id', businessId);
      
    if (error) console.error(error);
    else fetchData();
    setEntityToDelete(null);
    setDeleteModalOpen(false);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  const filteredExpenses = visibleExpenses.filter(e => {
    const matchesSearch = 
      (e.category && e.category.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (e.description && e.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (e.date && e.date.includes(searchQuery));
    const matchesCategory = categoryFilter === 'All' || e.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const openNewModal = () => {
    setFormError(null);
    setFormData({
      date: new Date().toISOString().split('T')[0], 
      category: 'Rental', 
      description: '', 
      amount: 0,
      branch_id: selectedBranchId || (branches[0]?.id || '')
    });
    setEditingId(null);
    setIsModalOpen(true);
  };

  const getBranchName = (branchId?: string | null) => {
    if (!branchId) return null;
    return branches.find(b => b.id === branchId)?.name || null;
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="page-header">
        <div>
          <h1>{t('expenses')}</h1>
          <p className="text-muted">Track outgoing operational costs.</p>
        </div>
        <button onClick={openNewModal} className="btn btn-primary">
          <Plus size={18} /> Record Expense
        </button>
      </header>

      {isSalaryAuthorized && !loading && !loadError && visibleUnresolvedSalaryExpenses.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm text-amber-900">
              <p className="font-semibold">
                {visibleUnresolvedSalaryExpenses.length} Unresolved Salary Expense{visibleUnresolvedSalaryExpenses.length === 1 ? '' : 's'} ({formatCurrency(visibleUnresolvedSalaryExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0))})
              </p>
              <p className="text-amber-800 mt-0.5">
                Classify each unlinked Salary expense as a Linked Payroll Duplicate or a Confirmed Standalone Salary Expense so financial totals are accurate.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openReconcileModal()}
            className="btn btn-outline text-xs whitespace-nowrap self-start sm:self-center"
          >
            Reconcile Salary Expenses
          </button>
        </div>
      )}

      {/* Toolbar: Search and Category Filter */}
      {!loading && !loadError && visibleExpenses.length > 0 && (
        <div className="management-toolbar">
          <div className="search-input-wrapper">
            <span className="search-icon">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search expenses..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted font-medium">Filter Category:</span>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="input text-sm py-1.5 bg-white cursor-pointer"
              style={{ padding: '0.4rem 0.75rem' }}
            >
              <option value="All">All Categories</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-state-card">
          <Loader2 size={28} className="loading-spinner" />
          <span>Loading expenses...</span>
        </div>
      ) : loadError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm text-red-900">
              <p className="font-semibold">Unable to load expenses</p>
              <p className="text-red-800 mt-0.5">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void fetchData()}
            className="btn btn-outline text-xs whitespace-nowrap self-start sm:self-center"
          >
            Retry
          </button>
        </div>
      ) : visibleExpenses.length === 0 ? (
        <EmptyState 
          icon={Receipt} 
          title={`No ${t('expenses').toLowerCase()} yet`} 
          description="Record your first expense to track your outgoing operational costs."
          actionLabel="Record Expense"
          onAction={openNewModal}
        />
      ) : filteredExpenses.length === 0 ? (
        <div className="card text-center text-muted" style={{ padding: '3rem 1.5rem' }}>
          <p className="font-medium text-base" style={{ color: 'var(--text-primary)' }}>No matching expenses found</p>
          <p className="text-sm text-muted" style={{ marginTop: '0.25rem' }}>Try adjusting your search query or category filter.</p>
        </div>
      ) : (
        <div className="card-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                {isMultiBranch && <th>Branch</th>}
                <th>Category</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map(e => (
                <tr key={e.id}>
                  <td className="text-secondary font-medium">{e.date}</td>
                  {isMultiBranch && (
                    <td>
                      {getBranchName(e.branch_id) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full">
                          <Building2 size={12} />
                          {getBranchName(e.branch_id)}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  )}
                  <td>
                    <span className="badge badge-neutral">{e.category}</span>
                  </td>
                  <td className="font-medium">{e.description || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--danger)' }}>
                    −{formatCurrency(e.amount)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="action-buttons-group">
                      <button onClick={() => handleEdit(e)} className="action-btn edit" title="Edit expense">
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => {
                          setEntityToDelete({ id: e.id, name: `Expense for ${e.category}` });
                          setDeleteModalOpen(true);
                        }} 
                        className="action-btn delete" 
                        title="Delete expense"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? 'Edit Expense' : 'Record Expense'}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-red-800">Unable to save expense</p>
                <p className="text-xs text-red-600 mt-0.5">{formError}</p>
              </div>
            </div>
          )}

          {isMultiBranch && !isStaff && (
            <div className="input-group">
              <label className="input-label">Branch</label>
              <select
                required
                className="input bg-white text-base sm:text-sm"
                value={formData.branch_id}
                onChange={e => { setFormError(null); setFormData({ ...formData, branch_id: e.target.value }); }}
              >
                <option value="">Select branch...</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Date</label>
              <input type="date" required className="input text-base sm:text-sm" value={formData.date} onChange={e => { setFormError(null); setFormData({...formData, date: e.target.value}); }} />
            </div>
            <div className="input-group">
              <label className="input-label">Category</label>
              <select className="input bg-white text-base sm:text-sm" value={formData.category} onChange={e => { setFormError(null); setFormData({...formData, category: e.target.value}); }}>
                {categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Description</label>
            <input type="text" required className="input text-base sm:text-sm" placeholder="e.g. November Electricity Bill" value={formData.description} onChange={e => { setFormError(null); setFormData({...formData, description: e.target.value}); }} />
          </div>

          <div className="input-group">
            <label className="input-label">Amount (RM)</label>
            <input type="number" required min="0" step="any" className="input text-base sm:text-sm" value={formData.amount} onChange={e => { setFormError(null); setFormData({...formData, amount: Number(e.target.value)}); }} />
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 mt-4">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn btn-ghost w-full sm:w-auto" disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary w-full sm:w-auto min-w-[120px]" disabled={submitting}>
              {submitting ? 'Saving...' : (editingId ? 'Update' : 'Create')}
            </button>
          </div>
        </form>
      </Modal>

      {entityToDelete && businessId && (
        <DeleteConfirmationModal
          isOpen={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={handleDeleteConfirm}
          entityType="expense"
          entityId={entityToDelete.id}
          entityName={entityToDelete.name}
          businessId={businessId}
        />
      )}

      {isSalaryAuthorized && (
        <Modal
          isOpen={reconcileModalOpen}
          onClose={() => {
            if (!reconcileSubmitting) {
              reconcileOptionsSeqRef.current += 1;
              setReconcileModalOpen(false);
              setReconcileConfirming(false);
            }
          }}
          title="Reconcile Unresolved Salary Expense"
        >
          <div className="flex flex-col gap-4">
            {reconcileError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                {reconcileError}
              </div>
            )}

            {visibleUnresolvedSalaryExpenses.length > 1 && (
              <div className="input-group">
                <label className="input-label">Select Unresolved Salary Expense</label>
                <select
                  className="input bg-white"
                  value={selectedExpense?.id || ''}
                  onChange={(e) => {
                    const next = visibleUnresolvedSalaryExpenses.find((x) => x.id === e.target.value) || null;
                    if (next) openReconcileModal(next);
                  }}
                >
                  {visibleUnresolvedSalaryExpenses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.date} · {formatCurrency(item.amount)} · {item.branch_name || 'Unassigned'} · {item.description}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedExpense ? (
              <>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                  <p><span className="font-semibold">Expense ID:</span> {selectedExpense.id}</p>
                  <p><span className="font-semibold">Date:</span> {selectedExpense.date}</p>
                  <p><span className="font-semibold">Amount:</span> {formatCurrency(selectedExpense.amount)}</p>
                  <p><span className="font-semibold">Branch:</span> {selectedExpense.branch_name || 'Unassigned'}</p>
                  <p><span className="font-semibold">Description:</span> {selectedExpense.description}</p>
                </div>

                <div className="input-group">
                  <label className="input-label">Classification</label>
                  <select
                    className="input bg-white"
                    value={reconcileAction}
                    onChange={(e) => {
                      setReconcileAction(e.target.value as 'linked_duplicate' | 'standalone' | 'unresolved');
                      setReconcileConfirming(false);
                      setReconcileError(null);
                    }}
                  >
                    <option value="standalone">Confirmed Standalone Salary Expense (include in Total Expenses)</option>
                    <option value="linked_duplicate">Linked Payroll Duplicate (link to teacher payment; exclude from Expenses)</option>
                    <option value="unresolved">Keep Unresolved (remain pending reconciliation)</option>
                  </select>
                </div>

                {reconcileAction === 'linked_duplicate' && (
                  <div className="input-group">
                    <label className="input-label">Matching Teacher Payment (Same Branch)</label>
                    <select
                      className="input bg-white"
                      value={selectedStaffPaymentId}
                      onChange={(e) => {
                        setSelectedStaffPaymentId(e.target.value);
                        setReconcileConfirming(false);
                        setReconcileError(null);
                      }}
                    >
                      <option value="">-- Select teacher payment record --</option>
                      {staffPaymentOptions.map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.date} · {sp.month} {sp.year} · {formatCurrency(sp.amount)} · {sp.staff_name || sp.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {reconcileConfirming ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-2">
                    <p className="font-semibold">Confirm Classification Change</p>
                    <p>
                      This will update expense {selectedExpense.id.slice(0, 8)} to <strong>{reconcileAction}</strong> and record an audit log entry.
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={reconcileSubmitting}
                        onClick={() => setReconcileConfirming(false)}
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary text-xs"
                        disabled={reconcileSubmitting}
                        onClick={handleReconcileSave}
                      >
                        {reconcileSubmitting ? 'Saving...' : 'Confirm & Save Classification'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setReconcileModalOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        if (reconcileAction === 'linked_duplicate' && !selectedStaffPaymentId) {
                          setReconcileError('Please select a matching teacher payment record.');
                          return;
                        }
                        setReconcileConfirming(true);
                      }}
                    >
                      Review & Confirm
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">No unresolved Salary expenses pending reconciliation.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
