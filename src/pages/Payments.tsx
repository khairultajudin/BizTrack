import React, { useEffect, useState, useCallback } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/ui/Modal';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import { Plus, Edit2, Trash2, CreditCard, AlertCircle, CheckCircle, Clock, XCircle, Search, Loader2 } from 'lucide-react';
import { EmptyState } from '../core/ui/EmptyState';
import { formatCurrency } from '../lib/currency';

interface Payment {
  id: string;
  customer_id: string;
  month: string;
  year: number;
  amount: number;
  payment_date: string;
  payment_method: string;
  status: string;
  reference_number?: string;
  customers?: { name: string };
}

export const Payments: React.FC = () => {
  const { t } = useTemplate();
  const { businessId, user } = useAuth();
  
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<{id: string, name: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [entityToDelete, setEntityToDelete] = useState<{id: string, name: string} | null>(null);
  
  const currentMonth = new Date().toLocaleString('default', { month: 'long' });
  const currentYear = new Date().getFullYear();

  const [formData, setFormData] = useState({
    customer_id: '', month: currentMonth, year: currentYear, amount: 0, 
    payment_date: new Date().toISOString().split('T')[0], 
    payment_method: 'Cash', status: 'Paid', reference_number: ''
  });

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    const [payRes, custRes] = await Promise.all([
      supabase.from('payments').select('*, customers(name)').eq('business_id', businessId).order('payment_date', { ascending: false }),
      supabase.from('customers').select('id, name').eq('business_id', businessId)
    ]);
    
    if (payRes.data) setPayments(payRes.data);
    if (custRes.data) setCustomers(custRes.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!businessId) {
      setFormError('Workspace context missing. Please refresh the page and try again.');
      return;
    }

    if (!formData.customer_id) {
      setFormError(`Please select a ${t('students').toLowerCase()}.`);
      return;
    }

    setSubmitting(true);

    const payload = {
      customer_id: formData.customer_id,
      month: formData.month,
      year: Number(formData.year),
      amount: isNaN(Number(formData.amount)) ? 0 : Number(formData.amount),
      payment_date: formData.payment_date,
      payment_method: formData.payment_method || 'Cash',
      status: formData.status || 'Paid',
      reference_number: formData.reference_number.trim() || null,
      business_id: businessId
    };

    try {
      let saveError: any = null;

      if (editingId) {
        const { error } = await supabase
          .from('payments')
          .update(payload)
          .eq('id', editingId)
          .eq('business_id', businessId);
        saveError = error;
      } else {
        const { error } = await supabase
          .from('payments')
          .insert([payload]);
        saveError = error;
      }

      if (saveError) {
        console.error('Supabase error saving payment:', {
          message: saveError.message,
          details: saveError.details,
          hint: saveError.hint,
          code: saveError.code,
          fullError: saveError
        });
        setFormError(saveError.message || 'Unable to save payment record. Please check your input.');
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

  const handleEdit = (payment: Payment) => {
    setFormError(null);
    setFormData({
      customer_id: payment.customer_id, 
      month: payment.month, 
      year: payment.year, 
      amount: payment.amount, 
      payment_date: payment.payment_date,
      payment_method: payment.payment_method,
      status: payment.status,
      reference_number: payment.reference_number || ''
    });
    setEditingId(payment.id);
    setIsModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!businessId || !entityToDelete) return;
    const { error } = await supabase.from('payments')
      .delete()
      .eq('id', entityToDelete.id)
      .eq('business_id', businessId);
      
    if (error) console.error(error);
    else fetchData();
    setEntityToDelete(null);
    setDeleteModalOpen(false);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const filteredPayments = payments.filter(p => {
    const matchesSearch = 
      (p.customers?.name && p.customers.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.month && p.month.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.payment_method && p.payment_method.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.payment_date && p.payment_date.includes(searchQuery));
    const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openNewModal = () => {
    setFormError(null);
    setFormData({
      customer_id: customers.length > 0 ? customers[0].id : '', 
      month: currentMonth, year: currentYear, amount: 0, 
      payment_date: new Date().toISOString().split('T')[0], 
      payment_method: 'Cash', status: 'Paid', reference_number: ''
    });
    setEditingId(null);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="page-header">
        <div>
          <h1>{t('payments')}</h1>
          <p className="text-muted">Track incoming collections from your {t('students').toLowerCase()}.</p>
        </div>
        <button onClick={openNewModal} className="btn btn-primary">
          <Plus size={18} /> Record Payment
        </button>
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
              placeholder="Search payments..."
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
          actionLabel="Record Payment"
          onAction={openNewModal}
        />
      ) : filteredPayments.length === 0 ? (
        <div className="card text-center text-muted" style={{ padding: '3rem 1.5rem' }}>
          <p className="font-medium text-base" style={{ color: 'var(--text-primary)' }}>No matching payments found</p>
          <p className="text-sm text-muted" style={{ marginTop: '0.25rem' }}>Try adjusting your search query or filter settings.</p>
        </div>
      ) : (
        <div className="card-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Student</th>
                <th>For Period</th>
                <th>Method</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map(p => (
                <tr key={p.id}>
                  <td className="text-secondary font-medium">{p.payment_date}</td>
                  <td className="font-semibold">{p.customers?.name || '—'}</td>
                  <td>
                    <span className="badge badge-neutral">{p.month} {p.year}</span>
                  </td>
                  <td className="text-secondary">{p.payment_method || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {formatCurrency(p.amount)}
                  </td>
                  <td>
                    <span className={`badge ${
                      p.status === 'Paid' ? 'badge-success' : 
                      p.status === 'Pending' ? 'badge-neutral' : 'badge-archived'
                    }`}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="action-buttons-group">
                      <button onClick={() => handleEdit(p)} className="action-btn edit" title="Edit payment">
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => {
                          setEntityToDelete({ id: p.id, name: `Payment for ${p.customers?.name || 'Customer'}` });
                          setDeleteModalOpen(true);
                        }} 
                        className="action-btn delete"
                        title="Delete payment"
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

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? 'Edit Payment' : 'Record Payment'}>
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
            <select required className="input bg-white text-base sm:text-sm" value={formData.customer_id} onChange={e => { setFormError(null); setFormData({...formData, customer_id: e.target.value}); }}>
              <option value="" disabled>-- Select --</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
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
              <label className="input-label">Amount (RM)</label>
              <input type="number" required min="0" step="any" className="input text-base sm:text-sm" value={formData.amount} onChange={e => { setFormError(null); setFormData({...formData, amount: Number(e.target.value)}); }} />
            </div>
            <div className="input-group">
              <label className="input-label">Date</label>
              <input type="date" required className="input text-base sm:text-sm" value={formData.payment_date} onChange={e => { setFormError(null); setFormData({...formData, payment_date: e.target.value}); }} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">For Month</label>
              <select className="input bg-white text-base sm:text-sm" value={formData.month} onChange={e => { setFormError(null); setFormData({...formData, month: e.target.value}); }}>
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">For Year</label>
              <input type="number" required className="input text-base sm:text-sm" value={formData.year} onChange={e => { setFormError(null); setFormData({...formData, year: Number(e.target.value)}); }} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Method</label>
              <select className="input bg-white text-base sm:text-sm" value={formData.payment_method} onChange={e => { setFormError(null); setFormData({...formData, payment_method: e.target.value}); }}>
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Credit Card">Credit Card</option>
                <option value="Online">Online</option>
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Status</label>
              <select className="input bg-white text-base sm:text-sm" value={formData.status} onChange={e => { setFormError(null); setFormData({...formData, status: e.target.value}); }}>
                <option value="Paid">Paid</option>
                <option value="Pending">Pending</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 mt-4">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn btn-ghost w-full sm:w-auto" disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary w-full sm:w-auto min-w-[120px]" disabled={submitting}>
              {submitting ? 'Saving...' : (editingId ? 'Update' : 'Save')}
            </button>
          </div>
        </form>
      </Modal>

      {entityToDelete && businessId && (
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

