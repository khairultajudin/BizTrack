import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/ui/Modal';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import {
  Plus,
  Edit2,
  Trash2,
  CreditCard,
  AlertCircle,
  CheckCircle,
  Search,
  Loader2,
  FileText,
  Upload,
  ExternalLink,
  RefreshCw,
  X,
} from 'lucide-react';
import { EmptyState } from '../core/ui/EmptyState';
import { formatCurrency } from '../lib/currency';
import { StorageService } from '../services/StorageService';

interface Payment {
  id: string;
  business_id?: string;
  customer_id: string;
  month: string;
  year: number;
  amount: number;
  payment_date: string;
  payment_method: string;
  status: string;
  reference_number?: string | null;
  invoice_path?: string | null;
  customers?: { name: string };
}

export const Payments: React.FC = () => {
  const { t } = useTemplate();
  const { businessId, role, loading: authLoading } = useAuth();

  // Fail-closed explicit allowlist: false when role is null, loading, or 'ReadOnly'
  const canManageInvoices =
    !authLoading &&
    (role === 'Creator' ||
      role === 'Admin' ||
      role === 'Staff');

  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [entityToDelete, setEntityToDelete] = useState<{
    id: string;
    name: string;
    invoice_path?: string | null;
  } | null>(null);

  // Invoice attachment state
  const [currentInvoicePath, setCurrentInvoicePath] = useState<string | null>(null);
  const [selectedInvoiceFile, setSelectedInvoiceFile] = useState<File | null>(null);
  const [isReplacingInvoice, setIsReplacingInvoice] = useState(false);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [removingInvoice, setRemovingInvoice] = useState(false);
  const [viewingInvoicePath, setViewingInvoicePath] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceStatusMsg, setInvoiceStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentMonth = new Date().toLocaleString('default', { month: 'long' });
  const currentYear = new Date().getFullYear();

  const [formData, setFormData] = useState({
    customer_id: '',
    month: currentMonth,
    year: currentYear,
    amount: 0,
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'Cash',
    status: 'Paid',
    reference_number: '',
  });

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    const [payRes, custRes] = await Promise.all([
      supabase
        .from('payments')
        .select('*, customers(name)')
        .eq('business_id', businessId)
        .order('payment_date', { ascending: false }),
      supabase.from('customers').select('id, name').eq('business_id', businessId),
    ]);

    if (payRes.data) setPayments(payRes.data);
    if (custRes.data) setCustomers(custRes.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resetInvoiceState = (existingPath: string | null = null) => {
    setCurrentInvoicePath(existingPath);
    setSelectedInvoiceFile(null);
    setIsReplacingInvoice(false);
    setUploadingInvoice(false);
    setRemovingInvoice(false);
    setInvoiceError(null);
    setInvoiceStatusMsg(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCloseModal = () => {
    if (submitting || uploadingInvoice || removingInvoice) return;
    setIsModalOpen(false);
    setEditingId(null);
    setFormError(null);
    resetInvoiceState(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInvoiceError(null);
    setInvoiceStatusMsg(null);
    const file = e.target.files?.[0] || null;
    if (!file) {
      setSelectedInvoiceFile(null);
      return;
    }

    const validation = StorageService.validateInvoiceFile(file);
    if (!validation.valid) {
      setInvoiceError(validation.error || 'Invalid PDF file.');
      setSelectedInvoiceFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setSelectedInvoiceFile(file);
  };

  /**
   * Opens an uploaded invoice PDF via a short-lived signed URL.
   */
  const handleViewInvoice = async (invoicePath: string, paymentId?: string) => {
    if (!businessId || !invoicePath) return;
    setViewingInvoicePath(invoicePath);
    setInvoiceError(null);

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
      if (isModalOpen) {
        setInvoiceError(msg);
      } else {
        alert(msg);
      }
    } finally {
      setViewingInvoicePath(null);
    }
  };

  /**
   * Uploads or replaces an invoice PDF for an EXISTING saved payment record (editingId).
   * For new unsaved payments, the validated PDF is kept in component state and uploaded
   * only after full form validation & payment record creation in handleSubmit.
   */
  const handleUploadInvoice = async () => {
    setInvoiceError(null);
    setInvoiceStatusMsg(null);
    setFormError(null);

    if (!businessId) {
      setInvoiceError('Workspace context missing. Please refresh and try again.');
      return;
    }

    if (!canManageInvoices) {
      setInvoiceError('You do not have permission to upload or modify invoices.');
      return;
    }

    if (!editingId) {
      setInvoiceError('Save the payment record to upload the staged invoice PDF.');
      return;
    }

    const validation = StorageService.validateInvoiceFile(selectedInvoiceFile);
    if (!validation.valid || !selectedInvoiceFile) {
      setInvoiceError(validation.error || 'Please select a valid PDF file (max 5 MB).');
      return;
    }

    setUploadingInvoice(true);
    const previousInvoicePath = currentInvoicePath;

    try {
      // 1. Upload validated PDF to private 'invoices' bucket under {businessId}/{editingId}/
      const uploadedPath = await StorageService.uploadInvoice(
        businessId,
        editingId,
        selectedInvoiceFile
      );

      // 2. Associate storage path with payment record (without modifying existing amount or status)
      const updateFields: Record<string, any> = {
        invoice_path: uploadedPath,
        reference_number: formData.reference_number.trim() || null,
      };
      if (formData.payment_date) {
        updateFields.payment_date = formData.payment_date;
      }

      const { error: dbUpdateError } = await supabase
        .from('payments')
        .update(updateFields)
        .eq('id', editingId)
        .eq('business_id', businessId);

      if (dbUpdateError) {
        // Roll back storage upload to prevent orphaned files
        await StorageService.deleteInvoice(businessId, uploadedPath, editingId).catch(cleanupErr =>
          console.error('Failed to roll back orphaned invoice file:', cleanupErr)
        );
        throw new Error(dbUpdateError.message || 'Failed to save invoice reference to payment record.');
      }

      // 3. If replacing a previous invoice belonging to this payment, remove the old storage object
      if (previousInvoicePath && previousInvoicePath !== uploadedPath) {
        await StorageService.deleteInvoice(businessId, previousInvoicePath, editingId).catch(
          cleanupErr => console.warn('Failed to remove replaced invoice file from storage:', cleanupErr)
        );
      }

      setCurrentInvoicePath(uploadedPath);
      setSelectedInvoiceFile(null);
      setIsReplacingInvoice(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setInvoiceStatusMsg(
        previousInvoicePath ? 'Invoice PDF replaced successfully.' : 'Invoice PDF uploaded successfully.'
      );
      await fetchData();
    } catch (err: any) {
      console.error('Error uploading invoice PDF:', err);
      setInvoiceError(err?.message || 'Failed to upload invoice PDF. Please try again.');
    } finally {
      setUploadingInvoice(false);
    }
  };

  /**
   * Removes an existing invoice attachment from the current saved payment record.
   */
  const handleRemoveInvoice = async () => {
    if (!businessId || !editingId || !currentInvoicePath) return;
    if (!canManageInvoices) {
      setInvoiceError('You do not have permission to remove invoices.');
      return;
    }

    setRemovingInvoice(true);
    setInvoiceError(null);
    setInvoiceStatusMsg(null);

    const pathToRemove = currentInvoicePath;

    try {
      const { error: dbError } = await supabase
        .from('payments')
        .update({ invoice_path: null })
        .eq('id', editingId)
        .eq('business_id', businessId);

      if (dbError) {
        throw new Error(dbError.message || 'Failed to remove invoice attachment from payment.');
      }

      await StorageService.deleteInvoice(businessId, pathToRemove, editingId).catch(storageErr =>
        console.warn('Storage file removal warning:', storageErr)
      );

      setCurrentInvoicePath(null);
      setSelectedInvoiceFile(null);
      setIsReplacingInvoice(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setInvoiceStatusMsg('Invoice attachment removed.');
      await fetchData();
    } catch (err: any) {
      console.error('Error removing invoice PDF:', err);
      setInvoiceError(err?.message || 'Unable to remove invoice attachment.');
    } finally {
      setRemovingInvoice(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setInvoiceError(null);

    if (!businessId) {
      setFormError('Workspace context missing. Please refresh the page and try again.');
      return;
    }

    if (!canManageInvoices) {
      setFormError('You do not have permission to create or modify payment records.');
      return;
    }

    if (!formData.customer_id) {
      setFormError(`Please select a ${t('students').toLowerCase()}.`);
      return;
    }

    const numericAmount = Number(formData.amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setFormError('Payment amount must be greater than RM 0.00.');
      return;
    }

    if (!formData.payment_date) {
      setFormError('Payment date is required.');
      return;
    }

    // Validate staged invoice file before touching database
    if (selectedInvoiceFile) {
      const validation = StorageService.validateInvoiceFile(selectedInvoiceFile);
      if (!validation.valid) {
        setInvoiceError(validation.error || 'Invalid invoice PDF file.');
        return;
      }
    }

    setSubmitting(true);

    const payload = {
      customer_id: formData.customer_id,
      month: formData.month,
      year: Number(formData.year),
      amount: numericAmount,
      payment_date: formData.payment_date,
      payment_method: formData.payment_method || 'Cash',
      status: formData.status || 'Paid',
      reference_number: formData.reference_number.trim() || null,
      business_id: businessId,
    };

    try {
      let targetPaymentId = editingId;

      if (targetPaymentId) {
        const { error: updateErr } = await supabase
          .from('payments')
          .update(payload)
          .eq('id', targetPaymentId)
          .eq('business_id', businessId);

        if (updateErr) {
          console.error('Supabase error updating payment:', updateErr);
          setFormError(updateErr.message || 'Unable to save payment record. Please check your input.');
          setSubmitting(false);
          return;
        }
      } else {
        const { data: created, error: insertErr } = await supabase
          .from('payments')
          .insert([payload])
          .select()
          .single();

        if (insertErr || !created) {
          console.error('Supabase error creating payment:', insertErr);
          setFormError(insertErr?.message || 'Unable to save payment record. Please check your input.');
          setSubmitting(false);
          return;
        }

        targetPaymentId = created.id;
        // Bind editingId after valid payment creation so retries never duplicate the payment
        setEditingId(created.id);
      }

      // Upload and link staged PDF file against the saved payment ID
      if (selectedInvoiceFile && targetPaymentId) {
        const previousPath = currentInvoicePath;
        const uploadedPath = await StorageService.uploadInvoice(
          businessId,
          targetPaymentId,
          selectedInvoiceFile
        );

        const { error: invoiceDbErr } = await supabase
          .from('payments')
          .update({ invoice_path: uploadedPath })
          .eq('id', targetPaymentId)
          .eq('business_id', businessId);

        if (invoiceDbErr) {
          await StorageService.deleteInvoice(businessId, uploadedPath, targetPaymentId).catch(
            cleanupErr => console.error('Failed to roll back orphaned invoice file:', cleanupErr)
          );
          await fetchData();
          setFormError(`Payment saved, but linking invoice failed: ${invoiceDbErr.message}`);
          setSubmitting(false);
          return;
        }

        if (previousPath && previousPath !== uploadedPath) {
          await StorageService.deleteInvoice(businessId, previousPath, targetPaymentId).catch(
            cleanupErr => console.warn('Failed to clean up replaced invoice file:', cleanupErr)
          );
        }
      }

      setSubmitting(false);
      setIsModalOpen(false);
      setEditingId(null);
      resetInvoiceState(null);
      fetchData();
    } catch (err: any) {
      console.error('Unexpected error in handleSubmit:', err);
      await fetchData();
      setFormError(err.message || 'An unexpected error occurred while saving.');
      setSubmitting(false);
    }
  };

  const handleEdit = (payment: Payment) => {
    if (!canManageInvoices) return;
    setFormError(null);
    setFormData({
      customer_id: payment.customer_id,
      month: payment.month,
      year: payment.year,
      amount: payment.amount,
      payment_date: payment.payment_date,
      payment_method: payment.payment_method,
      status: payment.status,
      reference_number: payment.reference_number || '',
    });
    setEditingId(payment.id);
    resetInvoiceState(payment.invoice_path || null);
    setIsModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!businessId || !entityToDelete || !canManageInvoices) return;
    const { error } = await supabase
      .from('payments')
      .delete()
      .eq('id', entityToDelete.id)
      .eq('business_id', businessId);

    if (error) {
      console.error(error);
    } else {
      if (entityToDelete.invoice_path) {
        await StorageService.deleteInvoice(
          businessId,
          entityToDelete.invoice_path,
          entityToDelete.id
        ).catch(cleanupErr =>
          console.warn('Failed to delete invoice file on payment deletion:', cleanupErr)
        );
      }
      fetchData();
    }
    setEntityToDelete(null);
    setDeleteModalOpen(false);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const filteredPayments = payments.filter(p => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      (p.customers?.name && p.customers.name.toLowerCase().includes(query)) ||
      (p.reference_number && p.reference_number.toLowerCase().includes(query)) ||
      (p.month && p.month.toLowerCase().includes(query)) ||
      (p.payment_method && p.payment_method.toLowerCase().includes(query)) ||
      (p.payment_date && p.payment_date.includes(searchQuery));
    const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openNewModal = () => {
    if (!canManageInvoices) return;
    setFormError(null);
    setFormData({
      customer_id: customers.length > 0 ? customers[0].id : '',
      month: currentMonth,
      year: currentYear,
      amount: 0,
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: 'Cash',
      status: 'Paid',
      reference_number: '',
    });
    setEditingId(null);
    resetInvoiceState(null);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="page-header">
        <div>
          <h1>{t('payments')}</h1>
          <p className="text-muted">
            Track incoming collections and invoice attachments from your {t('students').toLowerCase()}.
          </p>
        </div>
        {canManageInvoices && (
          <button onClick={openNewModal} className="btn btn-primary">
            <Plus size={18} /> Record Payment
          </button>
        )}
      </header>

      {/* Toolbar: Search and Filter */}
      {payments.length > 0 && (
        <div className="management-toolbar">
          <div className="search-input-wrapper">
            <span className="search-icon">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search payments or invoice no..."
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
              <option value="Paid">Paid</option>
              <option value="Pending">Pending</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-state-card">
          <Loader2 size={28} className="loading-spinner" />
          <span>Loading payments...</span>
        </div>
      ) : payments.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title={`No ${t('payments').toLowerCase()} yet`}
          description={`Record your first payment to track incoming collections from your ${t('students').toLowerCase()}.`}
          actionLabel={canManageInvoices ? 'Record Payment' : undefined}
          onAction={canManageInvoices ? openNewModal : undefined}
        />
      ) : filteredPayments.length === 0 ? (
        <div className="card text-center text-muted" style={{ padding: '3rem 1.5rem' }}>
          <p className="font-medium text-base" style={{ color: 'var(--text-primary)' }}>
            No matching payments found
          </p>
          <p className="text-sm text-muted" style={{ marginTop: '0.25rem' }}>
            Try adjusting your search query or filter settings.
          </p>
        </div>
      ) : (
        <div className="card-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Payment Date</th>
                <th>Student</th>
                <th>Invoice No.</th>
                <th>For Period</th>
                <th>Method</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
                <th>Invoice PDF</th>
                {canManageInvoices && <th style={{ textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map(p => (
                <tr key={p.id}>
                  <td className="text-secondary font-medium">{p.payment_date}</td>
                  <td className="font-semibold">{p.customers?.name || '—'}</td>
                  <td className="text-secondary">
                    {p.reference_number ? (
                      <span className="font-medium text-gray-800">{p.reference_number}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-neutral">
                      {p.month} {p.year}
                    </span>
                  </td>
                  <td className="text-secondary">{p.payment_method || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {formatCurrency(p.amount)}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        p.status === 'Paid'
                          ? 'badge-success'
                          : p.status === 'Pending'
                          ? 'badge-neutral'
                          : 'badge-archived'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td>
                    {p.invoice_path ? (
                      <button
                        type="button"
                        onClick={() => handleViewInvoice(p.invoice_path!, p.id)}
                        disabled={viewingInvoicePath === p.invoice_path}
                        className="badge badge-blue cursor-pointer hover:bg-blue-100 transition-colors"
                        title={`View ${StorageService.extractInvoiceFileName(p.invoice_path)}`}
                      >
                        {viewingInvoicePath === p.invoice_path ? (
                          <Loader2 size={12} className="loading-spinner" />
                        ) : (
                          <FileText size={12} />
                        )}
                        <span>View Invoice</span>
                      </button>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
                  {canManageInvoices && (
                    <td style={{ textAlign: 'right' }}>
                      <div className="action-buttons-group">
                        <button
                          onClick={() => handleEdit(p)}
                          className="action-btn edit"
                          title="Edit payment & invoice"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setEntityToDelete({
                              id: p.id,
                              name: `Payment for ${p.customers?.name || 'Customer'}`,
                              invoice_path: p.invoice_path,
                            });
                            setDeleteModalOpen(true);
                          }}
                          className="action-btn delete"
                          title="Delete payment"
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

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingId ? 'Edit Payment' : 'Record Payment'}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-red-800">Unable to save payment</p>
                <p className="text-xs text-red-600 mt-0.5">{formError}</p>
              </div>
            </div>
          )}

          <div className="input-group">
            <label className="input-label">Select {t('students')}</label>
            <select
              required
              className="input bg-white text-base sm:text-sm"
              value={formData.customer_id}
              onChange={e => {
                setFormError(null);
                setFormData({ ...formData, customer_id: e.target.value });
              }}
            >
              <option value="" disabled>
                -- Select --
              </option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {customers.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                No students found. Add a student first to record payments.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Invoice Number</label>
              <input
                type="text"
                className="input text-base sm:text-sm"
                placeholder="Enter invoice number"
                value={formData.reference_number}
                onChange={e => {
                  setFormError(null);
                  setFormData({ ...formData, reference_number: e.target.value });
                }}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Payment Date</label>
              <input
                type="date"
                required
                className="input text-base sm:text-sm"
                value={formData.payment_date}
                onChange={e => {
                  setFormError(null);
                  setFormData({ ...formData, payment_date: e.target.value });
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Amount (RM)</label>
              <input
                type="number"
                required
                min="0.01"
                step="any"
                className="input text-base sm:text-sm"
                value={formData.amount}
                onChange={e => {
                  setFormError(null);
                  setFormData({ ...formData, amount: Number(e.target.value) });
                }}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Method</label>
              <select
                className="input bg-white text-base sm:text-sm"
                value={formData.payment_method}
                onChange={e => {
                  setFormError(null);
                  setFormData({ ...formData, payment_method: e.target.value });
                }}
              >
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Credit Card">Credit Card</option>
                <option value="Online">Online</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="input-group">
              <label className="input-label">For Month</label>
              <select
                className="input bg-white text-base sm:text-sm"
                value={formData.month}
                onChange={e => {
                  setFormError(null);
                  setFormData({ ...formData, month: e.target.value });
                }}
              >
                {[
                  'January',
                  'February',
                  'March',
                  'April',
                  'May',
                  'June',
                  'July',
                  'August',
                  'September',
                  'October',
                  'November',
                  'December',
                ].map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">For Year</label>
              <input
                type="number"
                required
                className="input text-base sm:text-sm"
                value={formData.year}
                onChange={e => {
                  setFormError(null);
                  setFormData({ ...formData, year: Number(e.target.value) });
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
                <option value="Paid">Paid</option>
                <option value="Pending">Pending</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Invoice PDF Attachment Section */}
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/70 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-blue-600" />
                <span className="text-sm font-semibold text-gray-800">Invoice PDF</span>
              </div>
              <span className="text-xs text-muted">Optional • PDF only • Max 5 MB</span>
            </div>

            {invoiceError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-xs flex items-center gap-2">
                <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                <span>{invoiceError}</span>
              </div>
            )}

            {invoiceStatusMsg && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-md text-xs flex items-center gap-2">
                <CheckCircle size={14} className="text-green-600 flex-shrink-0" />
                <span>{invoiceStatusMsg}</span>
              </div>
            )}

            {currentInvoicePath && !isReplacingInvoice ? (
              <div className="bg-white border border-gray-200 rounded-md p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText size={18} className="text-blue-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p
                      className="text-sm font-medium text-gray-900 truncate"
                      title={StorageService.extractInvoiceFileName(currentInvoicePath)}
                    >
                      {StorageService.extractInvoiceFileName(currentInvoicePath)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="badge badge-success" style={{ padding: '0.15rem 0.5rem', fontSize: '0.7rem' }}>
                        <CheckCircle size={10} /> Uploaded
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleViewInvoice(currentInvoicePath, editingId || undefined)}
                    disabled={viewingInvoicePath === currentInvoicePath}
                    className="btn btn-outline text-xs py-1.5 px-2.5"
                  >
                    {viewingInvoicePath === currentInvoicePath ? (
                      <Loader2 size={14} className="loading-spinner" />
                    ) : (
                      <ExternalLink size={14} />
                    )}
                    View Invoice
                  </button>

                  {canManageInvoices && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setInvoiceError(null);
                          setInvoiceStatusMsg(null);
                          setIsReplacingInvoice(true);
                        }}
                        disabled={removingInvoice || uploadingInvoice}
                        className="btn btn-outline text-xs py-1.5 px-2.5"
                      >
                        <RefreshCw size={13} /> Replace
                      </button>

                      <button
                        type="button"
                        onClick={handleRemoveInvoice}
                        disabled={removingInvoice || uploadingInvoice}
                        className="btn btn-ghost text-red-600 hover:bg-red-50 text-xs py-1.5 px-2.5"
                      >
                        {removingInvoice ? (
                          <Loader2 size={13} className="loading-spinner" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : canManageInvoices ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleFileChange}
                    disabled={uploadingInvoice || submitting}
                    className="input bg-white text-xs py-1.5 flex-1 file:mr-3 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                  />

                  {editingId && (
                    <button
                      type="button"
                      onClick={handleUploadInvoice}
                      disabled={!selectedInvoiceFile || uploadingInvoice || submitting}
                      className="btn btn-outline text-xs py-2 px-3 whitespace-nowrap bg-white"
                    >
                      {uploadingInvoice ? (
                        <>
                          <Loader2 size={14} className="loading-spinner" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload size={14} />
                          Upload Invoice
                        </>
                      )}
                    </button>
                  )}

                  {isReplacingInvoice && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsReplacingInvoice(false);
                        setSelectedInvoiceFile(null);
                        setInvoiceError(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      disabled={uploadingInvoice}
                      className="btn btn-ghost text-xs py-2 px-2.5"
                      title="Cancel replacement"
                    >
                      <X size={14} /> Cancel
                    </button>
                  )}
                </div>

                {selectedInvoiceFile && (
                  <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 flex items-center justify-between gap-2 text-xs text-blue-800">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={14} className="text-blue-600 flex-shrink-0" />
                      <span className="font-medium truncate">
                        {selectedInvoiceFile.name} ({(selectedInvoiceFile.size / 1024).toFixed(1)} KB)
                      </span>
                      <span className="badge badge-blue" style={{ padding: '0.1rem 0.4rem', fontSize: '0.68rem' }}>
                        {editingId ? 'Ready to upload' : 'Staged for Save'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedInvoiceFile(null);
                        setInvoiceError(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="text-blue-700 hover:text-blue-900 font-medium"
                      title="Clear selected file"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted">No invoice attached. Read-only users cannot upload invoices.</p>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 mt-2">
            <button
              type="button"
              onClick={handleCloseModal}
              className="btn btn-ghost w-full sm:w-auto"
              disabled={submitting || uploadingInvoice}
            >
              Cancel
            </button>
            {canManageInvoices && (
              <button
                type="submit"
                className="btn btn-primary w-full sm:w-auto min-w-[120px]"
                disabled={submitting || uploadingInvoice}
              >
                {submitting ? 'Saving...' : editingId ? 'Update' : 'Save'}
              </button>
            )}
          </div>
        </form>
      </Modal>

      {entityToDelete && businessId && canManageInvoices && (
        <DeleteConfirmationModal
          isOpen={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={handleDeleteConfirm}
          entityType="payment"
          entityId={entityToDelete.id}
          entityName={entityToDelete.name}
          businessId={businessId}
        />
      )}
    </div>
  );
};
