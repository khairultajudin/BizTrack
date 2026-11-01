import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/ui/Modal';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import {
  Plus,
  Edit2,
  Trash2,
  Users,
  AlertCircle,
  Search,
  Loader2,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { EmptyState } from '../core/ui/EmptyState';
import { formatCurrency } from '../lib/currency';
import { StorageService } from '../services/StorageService';

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  assigned_group_id: string | null;
  monthly_fee: number;
  status: string;
  groups?: { name: string };
}

interface StudentPaymentRecord {
  id: string;
  customer_id: string;
  month: string;
  year: number;
  amount: number;
  payment_date: string;
  payment_method: string;
  status: string;
  reference_number?: string | null;
  invoice_path?: string | null;
  created_at?: string;
}

export const Students: React.FC = () => {
  const { t } = useTemplate();
  const { businessId } = useAuth();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [payments, setPayments] = useState<StudentPaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [entityToDelete, setEntityToDelete] = useState<{ id: string; name: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Payment & Invoice History Modal state
  const [historyStudent, setHistoryStudent] = useState<Customer | null>(null);
  const [viewingInvoicePath, setViewingInvoicePath] = useState<string | null>(null);
  const [invoiceViewError, setInvoiceViewError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    assigned_group_id: '',
    monthly_fee: 0,
    status: 'Active',
  });

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    const [customersRes, groupsRes, paymentsRes] = await Promise.all([
      supabase
        .from('customers')
        .select('*, groups(name)')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false }),
      supabase.from('groups').select('id, name').eq('business_id', businessId),
      supabase
        .from('payments')
        .select('id, customer_id, month, year, amount, payment_date, payment_method, status, reference_number, invoice_path, created_at')
        .eq('business_id', businessId)
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false }),
    ]);

    if (customersRes.data) setCustomers(customersRes.data);
    if (groupsRes.data) setGroups(groupsRes.data);
    if (paymentsRes.data) setPayments(paymentsRes.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Group payments by customer_id preserving chronological order (latest payment first)
  const paymentsByCustomer = useMemo(() => {
    const map: Record<string, StudentPaymentRecord[]> = {};
    for (const p of payments) {
      if (!map[p.customer_id]) {
        map[p.customer_id] = [];
      }
      map[p.customer_id].push(p);
    }
    return map;
  }, [payments]);

  const handleViewInvoice = async (invoicePath: string, paymentId?: string) => {
    if (!businessId || !invoicePath) return;
    setViewingInvoicePath(invoicePath);
    setInvoiceViewError(null);

    try {
      const signedUrl = await StorageService.getInvoiceSignedUrl(
        businessId,
        invoicePath,
        StorageService.SIGNED_URL_EXPIRY_SECONDS,
        paymentId
      );
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      const msg = err?.message || 'Unable to open invoice PDF.';
      if (historyStudent) {
        setInvoiceViewError(msg);
      } else {
        alert(msg);
      }
    } finally {
      setViewingInvoicePath(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!businessId) {
      setFormError('Workspace context missing. Please refresh the page and try again.');
      return;
    }

    const nameTrimmed = formData.name.trim();
    if (!nameTrimmed) {
      setFormError('Student name is required.');
      return;
    }

    setSubmitting(true);

    const payload = {
      name: nameTrimmed,
      phone: formData.phone.trim() || null,
      email: formData.email.trim() || null,
      assigned_group_id:
        formData.assigned_group_id && formData.assigned_group_id !== 'none'
          ? formData.assigned_group_id
          : null,
      monthly_fee: isNaN(Number(formData.monthly_fee)) ? 0 : Number(formData.monthly_fee),
      status: formData.status || 'Active',
      business_id: businessId,
    };

    try {
      let saveError: any = null;

      if (editingId) {
        const { error } = await supabase
          .from('customers')
          .update(payload)
          .eq('id', editingId)
          .eq('business_id', businessId);
        saveError = error;
      } else {
        const { error } = await supabase.from('customers').insert([payload]);
        saveError = error;
      }

      if (saveError) {
        console.error('Supabase error saving student:', {
          message: saveError.message,
          details: saveError.details,
          hint: saveError.hint,
          code: saveError.code,
          fullError: saveError,
        });
        setFormError(saveError.message || 'Unable to save student record. Please check your input.');
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

  const handleEdit = (customer: Customer) => {
    setFormError(null);
    setFormData({
      name: customer.name,
      phone: customer.phone || '',
      email: customer.email || '',
      assigned_group_id: customer.assigned_group_id || '',
      monthly_fee: customer.monthly_fee || 0,
      status: customer.status || 'Active',
    });
    setEditingId(customer.id);
    setIsModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!businessId || !entityToDelete) return;

    // 1. Collect invoice paths belonging to this student's payments BEFORE ON DELETE CASCADE removes them
    const studentPayments = paymentsByCustomer[entityToDelete.id] || [];
    const verifiedPathsToCleanup = studentPayments
      .filter(p => p.invoice_path && StorageService.isPathOwnedByPayment(p.invoice_path, businessId, p.id))
      .map(p => p.invoice_path as string);

    // 2. Delete the student record (cascades to public.payments in PostgreSQL)
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', entityToDelete.id)
      .eq('business_id', businessId);

    if (error) {
      console.error(error);
    } else {
      // 3. Only after student deletion succeeds, safely remove the student's invoice PDFs from private storage
      if (verifiedPathsToCleanup.length > 0) {
        const cleanupResult = await StorageService.cleanupBusinessInvoices(
          businessId,
          verifiedPathsToCleanup
        );
        if (cleanupResult.errors.length > 0) {
          console.warn('Some student invoice files could not be removed from storage:', cleanupResult.errors);
        }
      }
      fetchData();
    }
    setEntityToDelete(null);
    setDeleteModalOpen(false);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const filteredCustomers = customers.filter(c => {
    const query = searchQuery.toLowerCase();
    const studentPayments = paymentsByCustomer[c.id] || [];
    const matchesInvoice = studentPayments.some(
      p => p.reference_number && p.reference_number.toLowerCase().includes(query)
    );
    const matchesSearch =
      c.name.toLowerCase().includes(query) ||
      (c.phone && c.phone.includes(searchQuery)) ||
      (c.email && c.email.toLowerCase().includes(query)) ||
      (c.groups?.name && c.groups.name.toLowerCase().includes(query)) ||
      matchesInvoice;

    const matchesStatus = statusFilter === 'All' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openNewModal = () => {
    setFormError(null);
    setFormData({
      name: '',
      phone: '',
      email: '',
      assigned_group_id: '',
      monthly_fee: 0,
      status: 'Active',
    });
    setEditingId(null);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="page-header">
        <div>
          <h1>{t('students')}</h1>
          <p className="text-muted">Manage your students, class assignments, and payment invoices.</p>
        </div>
        <button onClick={openNewModal} className="btn btn-primary">
          <Plus size={18} /> Add Student
        </button>
      </header>

      {/* Toolbar: Search and Filter */}
      {customers.length > 0 && (
        <div className="management-toolbar">
          <div className="search-input-wrapper">
            <span className="search-icon">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search students or invoice no..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted font-medium">Filter Status:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="input text-sm py-1.5 bg-white cursor-pointer"
              style={{ padding: '0.4rem 0.75rem' }}
            >
              <option value="All">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-state-card">
          <Loader2 size={28} className="loading-spinner" />
          <span>Loading students...</span>
        </div>
      ) : customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No students yet"
          description="Add your first student to start recording monthly payments and organizing classes."
          actionLabel="Add Student"
          onAction={openNewModal}
        >
          <div className="guide-box">
            <span style={{ fontWeight: 600 }}>💡 Recommended Setup Sequence:</span>
            <div className="guide-steps-flow">
              <span className="guide-step">1. Add Teachers</span>
              <span>➔</span>
              <span className="guide-step">2. Create Classes</span>
              <span>➔</span>
              <span className="guide-step highlight">3. Add Students</span>
              <span>➔</span>
              <span className="guide-step">4. Payments</span>
            </div>
          </div>
        </EmptyState>
      ) : filteredCustomers.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          <p className="font-medium text-base text-gray-700">No matching students found</p>
          <p className="text-sm text-muted mt-1">Try adjusting your search query or filter settings.</p>
        </div>
      ) : (
        <div className="card-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Contact</th>
                <th>Class</th>
                <th className="text-right">Monthly Fee</th>
                <th>Invoice Number</th>
                <th>Payment Date</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map(c => {
                const studentPayments = paymentsByCustomer[c.id] || [];
                const latestPayment = studentPayments[0] || null;
                const additionalCount = studentPayments.length > 1 ? studentPayments.length - 1 : 0;

                return (
                  <tr key={c.id}>
                    <td className="primary-text">{c.name}</td>
                    <td>
                      <div>
                        <div>{c.phone || <span className="text-muted">—</span>}</div>
                        {c.email && <div className="text-xs text-muted">{c.email}</div>}
                      </div>
                    </td>
                    <td>
                      {c.groups?.name ? (
                        <span className="badge badge-blue">{c.groups.name}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-right primary-text">{formatCurrency(c.monthly_fee)}</td>
                    <td>
                      {!latestPayment ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-gray-800">
                            {latestPayment.reference_number || <span className="text-muted">—</span>}
                          </span>
                          {latestPayment.invoice_path && (
                            <button
                              type="button"
                              onClick={() => handleViewInvoice(latestPayment.invoice_path!, latestPayment.id)}
                              disabled={viewingInvoicePath === latestPayment.invoice_path}
                              className="badge badge-blue cursor-pointer hover:bg-blue-100 transition-colors"
                              style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem' }}
                              title={`View Invoice PDF (${StorageService.extractInvoiceFileName(latestPayment.invoice_path)})`}
                            >
                              {viewingInvoicePath === latestPayment.invoice_path ? (
                                <Loader2 size={11} className="loading-spinner" />
                              ) : (
                                <FileText size={11} />
                              )}
                              <span>PDF</span>
                            </button>
                          )}
                          {additionalCount > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setInvoiceViewError(null);
                                setHistoryStudent(c);
                              }}
                              className="badge badge-neutral cursor-pointer hover:bg-gray-200 transition-colors"
                              style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem' }}
                              title={`View all ${studentPayments.length} payment records for ${c.name}`}
                            >
                              +{additionalCount} more
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      {!latestPayment ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <div>
                          <div className="text-secondary font-medium">{latestPayment.payment_date}</div>
                          {studentPayments.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                setInvoiceViewError(null);
                                setHistoryStudent(c);
                              }}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              Latest of {studentPayments.length} records
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          c.status === 'Active' ? 'badge-success' : 'badge-archived'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="action-buttons-group">
                        <button
                          onClick={() => {
                            setInvoiceViewError(null);
                            setHistoryStudent(c);
                          }}
                          className="action-btn edit"
                          title="View Payment & Invoice History"
                        >
                          <FileText size={16} />
                        </button>
                        <button
                          onClick={() => handleEdit(c)}
                          className="action-btn edit"
                          title="Edit Student"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setEntityToDelete({ id: c.id, name: c.name });
                            setDeleteModalOpen(true);
                          }}
                          className="action-btn delete"
                          title="Delete Student"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Student Create / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingId ? `Edit ${t('students')}` : `Add New ${t('students')}`}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-xs text-muted -mt-1">
            Enter student details and optionally assign them to an existing class (e.g. Year 2).
          </p>

          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-red-800">Unable to save student</p>
                <p className="text-xs text-red-600 mt-0.5">{formError}</p>
              </div>
            </div>
          )}

          <div className="input-group">
            <label className="input-label">Student Name</label>
            <input
              required
              type="text"
              className="input text-base sm:text-sm"
              value={formData.name}
              onChange={e => {
                setFormError(null);
                setFormData({ ...formData, name: e.target.value });
              }}
              placeholder="e.g. Ali bin Ahmad"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Phone</label>
              <input
                type="text"
                className="input text-base sm:text-sm"
                value={formData.phone}
                onChange={e => {
                  setFormError(null);
                  setFormData({ ...formData, phone: e.target.value });
                }}
                placeholder="e.g. 0123456789"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Email</label>
              <input
                type="email"
                className="input text-base sm:text-sm"
                value={formData.email}
                onChange={e => {
                  setFormError(null);
                  setFormData({ ...formData, email: e.target.value });
                }}
                placeholder="e.g. student@example.com"
              />
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Assign to {t('classes')}</label>
            <select
              className="input bg-white text-base sm:text-sm"
              value={formData.assigned_group_id}
              onChange={e => {
                setFormError(null);
                setFormData({ ...formData, assigned_group_id: e.target.value });
              }}
            >
              <option value="">-- None --</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            {groups.length === 0 ? (
              <p className="text-xs text-amber-600 mt-1">
                No active classes found. To assign a class like "Year 2", create it from the{' '}
                <a
                  href="/classes"
                  className="underline font-medium text-amber-700 hover:text-amber-900"
                >
                  Classes page
                </a>{' '}
                first, or leave as "-- None --".
              </p>
            ) : (
              <p className="text-xs text-muted mt-1">
                Optional. You can leave as "-- None --" or select a class.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Monthly Fee (RM)</label>
              <input
                type="number"
                required
                min="0"
                step="any"
                className="input text-base sm:text-sm"
                value={formData.monthly_fee}
                onChange={e => {
                  setFormError(null);
                  setFormData({ ...formData, monthly_fee: Number(e.target.value) });
                }}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Status</label>
              <select
                className="input bg-white text-base sm:text-sm"
                value={formData.status}
                onChange={e => {
                  setFormError(null);
                  setFormData({ ...formData, status: e.target.value });
                }}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="btn btn-ghost w-full sm:w-auto"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary w-full sm:w-auto min-w-[120px]"
              disabled={submitting}
            >
              {submitting ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Student Payment & Invoice History Modal */}
      <Modal
        isOpen={Boolean(historyStudent)}
        onClose={() => {
          setHistoryStudent(null);
          setInvoiceViewError(null);
        }}
        title={historyStudent ? `Payment & Invoice History — ${historyStudent.name}` : 'Payment History'}
      >
        {historyStudent && (
          <div className="flex flex-col gap-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between text-xs text-gray-700">
              <div>
                <span className="text-muted">Class:</span>{' '}
                <span className="font-semibold">{historyStudent.groups?.name || 'Unassigned'}</span>
              </div>
              <div>
                <span className="text-muted">Monthly Fee:</span>{' '}
                <span className="font-semibold">{formatCurrency(historyStudent.monthly_fee)}</span>
              </div>
            </div>

            {invoiceViewError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-xs flex items-center gap-2">
                <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                <span>{invoiceViewError}</span>
              </div>
            )}

            {(paymentsByCustomer[historyStudent.id] || []).length === 0 ? (
              <div className="text-center py-6 text-sm text-muted border border-dashed border-gray-200 rounded-lg">
                No payment or invoice records found for this student.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 max-h-[55vh] overflow-y-auto">
                {(paymentsByCustomer[historyStudent.id] || []).map(p => (
                  <div
                    key={p.id}
                    className="border border-gray-200 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-white"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="badge badge-neutral">
                          {p.month} {p.year}
                        </span>
                        <span className="font-semibold text-sm text-gray-900">
                          {formatCurrency(p.amount)}
                        </span>
                        <span
                          className={`badge ${
                            p.status === 'Paid'
                              ? 'badge-success'
                              : p.status === 'Pending'
                              ? 'badge-neutral'
                              : 'badge-archived'
                          }`}
                          style={{ padding: '0.15rem 0.5rem', fontSize: '0.7rem' }}
                        >
                          {p.status}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 flex items-center gap-3 flex-wrap">
                        <span>
                          <strong className="text-gray-700">Payment Date:</strong> {p.payment_date}
                        </span>
                        <span>
                          <strong className="text-gray-700">Invoice No.:</strong>{' '}
                          {p.reference_number || '—'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end">
                      {p.invoice_path ? (
                        <button
                          type="button"
                          onClick={() => handleViewInvoice(p.invoice_path!, p.id)}
                          disabled={viewingInvoicePath === p.invoice_path}
                          className="btn btn-outline text-xs py-1.5 px-2.5"
                          title={StorageService.extractInvoiceFileName(p.invoice_path)}
                        >
                          {viewingInvoicePath === p.invoice_path ? (
                            <Loader2 size={13} className="loading-spinner" />
                          ) : (
                            <ExternalLink size={13} />
                          )}
                          View Invoice
                        </button>
                      ) : (
                        <span className="text-xs text-muted">No invoice PDF</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  setHistoryStudent(null);
                  setInvoiceViewError(null);
                }}
                className="btn btn-outline text-xs"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {entityToDelete && businessId && (
        <DeleteConfirmationModal
          isOpen={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={handleDeleteConfirm}
          entityType="student"
          entityId={entityToDelete.id}
          entityName={entityToDelete.name}
          businessId={businessId}
        />
      )}
    </div>
  );
};
