import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { Modal } from '../components/ui/Modal';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import { Plus, Edit2, Trash2, GraduationCap, AlertCircle, Search, Loader2, Building2, CheckCircle2 } from 'lucide-react';
import { EmptyState } from '../core/ui/EmptyState';
import { formatCurrency } from '../lib/currency';

interface Staff {
  id: string;
  branch_id?: string | null;
  name: string;
  role: string;
  phone?: string;
  salary_type?: string;
  salary_amount?: number;
}

interface HistoricalPayrollAuditRow {
  payment_id: string;
  staff_id: string;
  teacher_name: string;
  month: string;
  year: number;
  amount: number;
  payment_date: string;
  notes?: string | null;
  payment_branch_id: string | null;
  payment_branch_name: string | null;
  teacher_current_branch_id: string | null;
  teacher_current_branch_name: string | null;
  active_class_branch_count: number;
  all_history_branch_count: number;
  transferred_before_migration: boolean;
  potential_wrong_current_branch_assignment: boolean;
  ownership_status: string;
  ownership_explanation: string;
}

interface PayrollReconciliationSummary {
  consolidated_payroll: number;
  pauh_jaya_payroll: number;
  kelisa_emas_payroll: number;
  branch_allocated_payroll: number;
  unmapped_payroll: number;
  total_payment_count: number;
  confidently_mapped_count: number;
  unmapped_payment_count: number;
  ambiguous_ownership_count: number;
  unestablished_branch_count: number;
  is_reconciled: boolean;
}

export interface ExecuteTeachersFetchParams {
  seqRef: { current: number };
  authLoading: boolean;
  userId: string | null | undefined;
  businessId: string | null | undefined;
  isSalaryAuthorized: boolean;
  callbacks: {
    setLoading: (loading: boolean) => void;
    setStaff: (rows: Staff[]) => void;
    setUnmappedPayments: (rows: HistoricalPayrollAuditRow[]) => void;
    setReconciliationSummary: (summary: PayrollReconciliationSummary | null) => void;
    setReconcileError?: (error: string | null) => void;
  };
  loadDirectory: () => Promise<Staff[]>;
  loadAuthorizedData: () => Promise<{
    staff: Staff[];
    unmappedPayments: HistoricalPayrollAuditRow[];
    reconciliationSummary: PayrollReconciliationSummary | null;
  }>;
}

export async function executeTeachersFetch({
  seqRef,
  authLoading,
  userId,
  businessId,
  isSalaryAuthorized,
  callbacks,
  loadDirectory,
  loadAuthorizedData,
}: ExecuteTeachersFetchParams): Promise<void> {
  const requestSeq = ++seqRef.current;

  if (authLoading) {
    return;
  }

  if (!userId || !businessId) {
    callbacks.setStaff([]);
    callbacks.setUnmappedPayments([]);
    callbacks.setReconciliationSummary(null);
    callbacks.setReconcileError?.(null);
    callbacks.setLoading(false);
    return;
  }

  callbacks.setLoading(true);
  callbacks.setStaff([]);
  callbacks.setUnmappedPayments([]);
  callbacks.setReconciliationSummary(null);
  callbacks.setReconcileError?.(null);

  try {
    if (!isSalaryAuthorized) {
      const rows = await loadDirectory();
      if (seqRef.current !== requestSeq) return;
      callbacks.setStaff(rows);
      callbacks.setUnmappedPayments([]);
      callbacks.setReconciliationSummary(null);
      return;
    }

    const result = await loadAuthorizedData();
    if (seqRef.current !== requestSeq) return;
    callbacks.setStaff(result.staff);
    callbacks.setUnmappedPayments(result.unmappedPayments);
    callbacks.setReconciliationSummary(result.reconciliationSummary);
  } catch (err) {
    if (seqRef.current !== requestSeq) return;
    console.error('Error loading teachers data:', err);
    callbacks.setStaff([]);
    callbacks.setUnmappedPayments([]);
    callbacks.setReconciliationSummary(null);
  } finally {
    if (seqRef.current === requestSeq) {
      callbacks.setLoading(false);
    }
  }
}

export const Teachers: React.FC = () => {
  const { t } = useTemplate();
  const { user, businessId, isSalaryAuthorized, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { branches, selectedBranchId, isMultiBranch } = useBranch();
  const fetchSeqRef = useRef(0);
  
  const [staff, setStaff] = useState<Staff[]>([]);
  const [unmappedPayments, setUnmappedPayments] = useState<HistoricalPayrollAuditRow[]>([]);
  const [reconciliationSummary, setReconciliationSummary] = useState<PayrollReconciliationSummary | null>(null);
  const [selectedBranchesByPayment, setSelectedBranchesByPayment] = useState<Record<string, string>>({});
  const [reconcilingPaymentId, setReconcilingPaymentId] = useState<string | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [entityToDelete, setEntityToDelete] = useState<{id: string, name: string} | null>(null);
  
  const [formData, setFormData] = useState({
    name: '', role: '', phone: '', salary_type: 'Monthly', salary_amount: 0, branch_id: ''
  });

  const fetchStaff = useCallback(async () => {
    await executeTeachersFetch({
      seqRef: fetchSeqRef,
      authLoading,
      userId,
      businessId,
      isSalaryAuthorized,
      callbacks: {
        setLoading,
        setStaff,
        setUnmappedPayments,
        setReconciliationSummary,
        setReconcileError,
      },
      loadDirectory: async () => {
        const dirRes = await supabase.rpc('get_staff_directory', { p_business_id: businessId });
        if (dirRes.error) {
          console.error('Error loading staff directory via RPC:', dirRes.error);
          return [];
        }
        return Array.isArray(dirRes.data) ? (dirRes.data as Staff[]) : [];
      },
      loadAuthorizedData: async () => {
        const [teachersRes, auditRes, summaryRes] = await Promise.all([
          supabase.rpc('get_teachers_with_salary', { p_business_id: businessId }),
          supabase.rpc('get_historical_payroll_audit', { p_business_id: businessId }),
          supabase.rpc('get_payroll_reconciliation_summary', {
            p_business_id: businessId,
            p_month: null,
            p_year: null,
          }),
        ]);

        let nextStaff: Staff[] = [];
        if (teachersRes.error) {
          console.error('Error loading teachers via RPC:', teachersRes.error);
        } else if (Array.isArray(teachersRes.data)) {
          nextStaff = teachersRes.data as Staff[];
        }

        const nextUnmapped =
          !auditRes.error && Array.isArray(auditRes.data)
            ? (auditRes.data as HistoricalPayrollAuditRow[]).filter(r => !r.payment_branch_id)
            : [];

        let nextSummary: PayrollReconciliationSummary | null = null;
        if (!summaryRes.error && Array.isArray(summaryRes.data) && summaryRes.data.length > 0) {
          const row = summaryRes.data[0];
          nextSummary = {
            consolidated_payroll: Number(row.consolidated_payroll || 0),
            pauh_jaya_payroll: Number(row.pauh_jaya_payroll || 0),
            kelisa_emas_payroll: Number(row.kelisa_emas_payroll || 0),
            branch_allocated_payroll: Number(row.branch_allocated_payroll || 0),
            unmapped_payroll: Number(row.unmapped_payroll || 0),
            total_payment_count: Number(row.total_payment_count || 0),
            confidently_mapped_count: Number(row.confidently_mapped_count || 0),
            unmapped_payment_count: Number(row.unmapped_payment_count || 0),
            ambiguous_ownership_count: Number(row.ambiguous_ownership_count || 0),
            unestablished_branch_count: Number(row.unestablished_branch_count || 0),
            is_reconciled: Boolean(row.is_reconciled),
          };
        }

        return {
          staff: nextStaff,
          unmappedPayments: nextUnmapped,
          reconciliationSummary: nextSummary,
        };
      },
    });
  }, [authLoading, userId, businessId, isSalaryAuthorized]);

  const handleAssignPaymentBranch = async (paymentId: string) => {
    if (!userId || !businessId || !isSalaryAuthorized) return;
    const targetBranchId = selectedBranchesByPayment[paymentId];
    if (!targetBranchId) {
      setReconcileError('Please select a branch before assigning.');
      return;
    }

    setReconcileError(null);
    setReconcilingPaymentId(paymentId);
    try {
      const { error } = await supabase.rpc('assign_staff_payment_branch', {
        p_business_id: businessId,
        p_payment_id: paymentId,
        p_branch_id: targetBranchId,
      });
      if (error) {
        setReconcileError(error.message || 'Unable to assign branch to payment record.');
      } else {
        await fetchStaff();
      }
    } catch (err: any) {
      setReconcileError(err?.message || 'Unexpected error while reconciling payment branch.');
    } finally {
      setReconcilingPaymentId(null);
    }
  };

  useEffect(() => {
    void fetchStaff();
    return () => {
      fetchSeqRef.current += 1;
    };
  }, [fetchStaff, selectedBranchId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!businessId || !isSalaryAuthorized) {
      setFormError('You are not authorized to modify teacher salary records.');
      return;
    }

    const nameTrimmed = formData.name.trim();
    if (!nameTrimmed) {
      setFormError('Teacher/Staff name is required.');
      return;
    }

    const numericSalary = isNaN(Number(formData.salary_amount)) ? 0 : Number(formData.salary_amount);
    if (numericSalary < 0) {
      setFormError('Salary amount cannot be negative.');
      return;
    }

    setSubmitting(true);

    try {
      const resolvedBranchId = isMultiBranch ? (formData.branch_id || selectedBranchId || null) : null;
      const { error: saveError } = await supabase.rpc('save_teacher_with_salary', {
        p_business_id: businessId,
        p_name: nameTrimmed,
        p_role: formData.role.trim() || 'Teacher',
        p_phone: formData.phone.trim() || null,
        p_salary_type: formData.salary_type || 'Monthly',
        p_salary_amount: numericSalary,
        p_notes: null,
        p_teacher_id: editingId || null,
        p_branch_id: resolvedBranchId,
      });

      if (saveError) {
        console.error('Supabase error saving teacher:', {
          message: saveError.message,
          details: saveError.details,
          hint: saveError.hint,
          code: saveError.code,
          fullError: saveError
        });
        setFormError(saveError.message || 'Unable to save teacher record. Please check your input.');
        setSubmitting(false);
        return; // DO NOT close modal on error
      }

      setSubmitting(false);
      setIsModalOpen(false);
      fetchStaff();
    } catch (err: any) {
      console.error('Unexpected error in handleSubmit:', err);
      setFormError(err.message || 'An unexpected error occurred while saving.');
      setSubmitting(false);
    }
  };

  const handleEdit = (member: Staff) => {
    setFormError(null);
    setFormData({
      name: member.name, role: member.role || '', phone: member.phone || '', 
      salary_type: member.salary_type || 'Monthly', salary_amount: member.salary_amount || 0,
      branch_id: member.branch_id || selectedBranchId || ''
    });
    setEditingId(member.id);
    setIsModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!businessId || !entityToDelete || !isSalaryAuthorized) return;

    const { error } = await supabase.rpc('delete_teacher', {
      p_business_id: businessId,
      p_teacher_id: entityToDelete.id
    });

    if (error) {
      console.error('Error deleting teacher via RPC:', error);
    } else {
      fetchStaff();
    }
    setDeleteModalOpen(false);
    setEntityToDelete(null);
  };

  const [searchQuery, setSearchQuery] = useState('');

  if (authLoading) {
    return (
      <div className="loading-state-card">
        <Loader2 size={28} className="loading-spinner" />
        <span>Verifying access...</span>
      </div>
    );
  }

  const filteredStaff = staff.filter(s => {
    if (selectedBranchId && isSalaryAuthorized && s.branch_id !== selectedBranchId) {
      return false;
    }
    if (selectedBranchId && !isSalaryAuthorized && s.branch_id && s.branch_id !== selectedBranchId) {
      return false;
    }
    return (
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.role && s.role.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (isSalaryAuthorized && s.phone && s.phone.includes(searchQuery)) ||
      (isSalaryAuthorized && s.salary_type && s.salary_type.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  });

  const openNewModal = () => {
    setFormError(null);
    setFormData({
      name: '', role: '', phone: '', salary_type: 'Monthly', salary_amount: 0,
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
          <h1>{t('teachers')}</h1>
          <p className="text-muted">
            {isSalaryAuthorized ? 'Manage your staff and instructors.' : 'View your branch teacher directory.'}
          </p>
        </div>
        {isSalaryAuthorized && (
          <button onClick={openNewModal} className="btn btn-primary">
            <Plus size={18} /> Add Teacher
          </button>
        )}
      </header>

      {/* Historical Payroll Reconciliation Panel (Puan Hana Only) */}
      {isSalaryAuthorized && isMultiBranch && reconciliationSummary && reconciliationSummary.total_payment_count > 0 && (
        <div className={`card p-5 border ${reconciliationSummary.unmapped_payment_count > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-emerald-200 bg-emerald-50/40'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start gap-2.5">
              {reconciliationSummary.unmapped_payment_count > 0 ? (
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  {reconciliationSummary.unmapped_payment_count > 0
                    ? `Historical Payroll Reconciliation Required (${reconciliationSummary.unmapped_payment_count} Unmapped Record${reconciliationSummary.unmapped_payment_count === 1 ? '' : 's'})`
                    : 'Historical Payroll Fully Reconciled Across Branches'}
                </h2>
                <p className="text-xs text-gray-700 mt-0.5">
                  Consolidated Payroll ({formatCurrency(reconciliationSummary.consolidated_payroll)}) = Pauh Jaya Payroll ({formatCurrency(reconciliationSummary.pauh_jaya_payroll)}) + Kelisa Emas Payroll ({formatCurrency(reconciliationSummary.kelisa_emas_payroll)}) + Unmapped Payroll ({formatCurrency(reconciliationSummary.unmapped_payroll)})
                </p>
              </div>
            </div>
          </div>

          {reconcileError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-xs">
              {reconcileError}
            </div>
          )}

          {unmappedPayments.length > 0 && (
            <div className="mt-4 overflow-x-auto bg-white rounded-lg border border-gray-200">
              <table className="data-table text-xs">
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th>Period</th>
                    <th className="text-right">Amount</th>
                    <th>Historical Status</th>
                    <th className="text-right">Assign Branch</th>
                  </tr>
                </thead>
                <tbody>
                  {unmappedPayments.map(payment => (
                    <tr key={payment.payment_id}>
                      <td className="font-medium text-gray-900">
                        {payment.teacher_name}
                        {payment.teacher_current_branch_name && (
                          <span className="block text-[11px] text-gray-500 font-normal">
                            Current branch: {payment.teacher_current_branch_name}
                          </span>
                        )}
                      </td>
                      <td>{payment.month} {payment.year}</td>
                      <td className="text-right font-semibold">{formatCurrency(payment.amount)}</td>
                      <td>
                        <span className="inline-block font-medium text-amber-800 bg-amber-100 px-2 py-0.5 rounded text-[11px]">
                          {payment.ownership_status}
                        </span>
                        <p className="text-[11px] text-gray-600 mt-0.5">{payment.ownership_explanation}</p>
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <select
                            className="input bg-white text-xs py-1 px-2 h-8"
                            value={selectedBranchesByPayment[payment.payment_id] || ''}
                            onChange={e =>
                              setSelectedBranchesByPayment(prev => ({
                                ...prev,
                                [payment.payment_id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">Select branch...</option>
                            {branches.map(b => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleAssignPaymentBranch(payment.payment_id)}
                            disabled={reconcilingPaymentId === payment.payment_id}
                            className="btn btn-primary text-xs py-1 px-3 h-8 whitespace-nowrap"
                          >
                            {reconcilingPaymentId === payment.payment_id ? 'Saving...' : 'Assign Branch'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Toolbar: Search */}
      {staff.length > 0 && (
        <div className="management-toolbar">
          <div className="search-input-wrapper">
            <span className="search-icon">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search teachers..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-state-card">
          <Loader2 size={28} className="loading-spinner" />
          <span>Loading teachers...</span>
        </div>
      ) : staff.length === 0 ? (
        <EmptyState 
          icon={GraduationCap} 
          title="No teachers yet" 
          description="Add your first teacher to start assigning them to classes and managing payroll."
          actionLabel="Add Teacher"
          onAction={openNewModal}
        >
          <div className="guide-box">
            <span style={{ fontWeight: 600 }}>💡 Recommended Setup Sequence:</span>
            <div className="guide-steps-flow">
              <span className="guide-step highlight">1. Add Teachers</span>
              <span>➔</span>
              <span className="guide-step">2. Create Classes</span>
              <span>➔</span>
              <span className="guide-step">3. Add Students</span>
              <span>➔</span>
              <span className="guide-step">4. Payments</span>
            </div>
          </div>
        </EmptyState>
      ) : filteredStaff.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          <p className="font-medium text-base text-gray-700">No matching teachers found</p>
          <p className="text-sm text-muted mt-1">Try adjusting your search query.</p>
        </div>
      ) : (
        <div className="card-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Teacher</th>
                {isMultiBranch && <th>Branch</th>}
                <th>Role</th>
                {isSalaryAuthorized && <th>Phone</th>}
                {isSalaryAuthorized && <th>Salary Type</th>}
                {isSalaryAuthorized && <th className="text-right">Monthly Amount</th>}
                {isSalaryAuthorized && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredStaff.map(s => (
                <tr key={s.id}>
                  <td className="primary-text">{s.name}</td>
                  {isMultiBranch && (
                    <td>
                      {getBranchName(s.branch_id) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full">
                          <Building2 size={12} />
                          {getBranchName(s.branch_id)}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  )}
                  <td>{s.role || <span className="text-muted">—</span>}</td>
                  {isSalaryAuthorized && (
                    <td>{s.phone || <span className="text-muted">—</span>}</td>
                  )}
                  {isSalaryAuthorized && (
                    <td>
                      <span className="badge badge-neutral">
                        {s.salary_type || 'Monthly'}
                      </span>
                    </td>
                  )}
                  {isSalaryAuthorized && (
                    <td className="text-right primary-text">
                      {formatCurrency(s.salary_amount ?? 0)}
                    </td>
                  )}
                  {isSalaryAuthorized && (
                    <td className="text-right">
                      <div className="action-buttons-group">
                        <button
                          onClick={() => handleEdit(s)}
                          className="action-btn edit"
                          title="Edit Teacher"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setEntityToDelete({ id: s.id, name: s.name });
                            setDeleteModalOpen(true);
                          }}
                          className="action-btn delete"
                          title="Delete Teacher"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? `Edit ${t('teachers')}` : `Add New ${t('teachers')}`}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-xs text-muted -mt-1">Enter staff details and salary configuration.</p>

          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-red-800">Unable to save teacher</p>
                <p className="text-xs text-red-600 mt-0.5">{formError}</p>
              </div>
            </div>
          )}

          <div className="input-group">
            <label className="input-label">Teacher Name</label>
            <input required type="text" className="input text-base sm:text-sm" value={formData.name} onChange={e => { setFormError(null); setFormData({...formData, name: e.target.value}); }} placeholder="e.g. Cikgu Sarah" />
          </div>
          {isMultiBranch && (
            <div className="input-group">
              <label className="input-label">Assigned Branch</label>
              <select
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
          <div className="input-group">
            <label className="input-label">Role</label>
            <input type="text" className="input text-base sm:text-sm" value={formData.role} onChange={e => { setFormError(null); setFormData({...formData, role: e.target.value}); }} placeholder="e.g. Science Instructor" />
          </div>
          <div className="input-group">
            <label className="input-label">Phone</label>
            <input type="text" className="input text-base sm:text-sm" value={formData.phone} onChange={e => { setFormError(null); setFormData({...formData, phone: e.target.value}); }} placeholder="e.g. 0123456789" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Salary Type</label>
              <select className="input bg-white text-base sm:text-sm" value={formData.salary_type} onChange={e => { setFormError(null); setFormData({...formData, salary_type: e.target.value}); }}>
                <option value="Monthly">Monthly</option>
                <option value="Hourly">Hourly</option>
                <option value="Commission">Commission</option>
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Amount (RM)</label>
              <input type="number" required min="0" step="any" className="input text-base sm:text-sm" value={formData.salary_amount} onChange={e => { setFormError(null); setFormData({...formData, salary_amount: Number(e.target.value)}); }} />
            </div>
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
          entityType="teacher"
          entityId={entityToDelete.id}
          entityName={entityToDelete.name}
          businessId={businessId}
        />
      )}
    </div>
  );
};

