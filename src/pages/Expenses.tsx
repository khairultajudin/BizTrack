import React, { useEffect, useState, useCallback } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/ui/Modal';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import { Plus, Edit2, Trash2, Receipt, AlertCircle, Search, Loader2 } from 'lucide-react';
import { EmptyState } from '../core/ui/EmptyState';
import { formatCurrency } from '../lib/currency';

interface Expense {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
}

export const Expenses: React.FC = () => {
  const { t } = useTemplate();
  const { businessId, user } = useAuth();
  
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [entityToDelete, setEntityToDelete] = useState<{id: string, name: string} | null>(null);

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0], 
    category: 'Rental', 
    description: '', 
    amount: 0
  });

  const categories = ['Rental', 'Utilities', 'Internet', 'Marketing', 'Salary', 'Equipment', 'Transport', 'Others'];

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('business_id', businessId)
      .order('date', { ascending: false });
      
    if (data) setExpenses(data);
    if (error) console.error(error);
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

    const descTrimmed = formData.description.trim();
    if (!descTrimmed) {
      setFormError('Expense description is required.');
      return;
    }

    setSubmitting(true);

    const payload = {
      date: formData.date,
      category: formData.category || 'Rental',
      description: descTrimmed,
      amount: isNaN(Number(formData.amount)) ? 0 : Number(formData.amount),
      business_id: businessId
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
      amount: expense.amount
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

  const filteredExpenses = expenses.filter(e => {
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
      amount: 0
    });
    setEditingId(null);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('expenses')}</h1>
          <p className="text-muted">Track outgoing operational costs.</p>
        </div>
        <button onClick={openNewModal} className="btn btn-primary">
          <Plus size={18} /> Record Expense
        </button>
      </header>

      {/* Toolbar: Search and Category Filter */}
      {expenses.length > 0 && (
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
      ) : expenses.length === 0 ? (
        <EmptyState 
          icon={Receipt} 
          title={`No ${t('expenses').toLowerCase()} yet`} 
          description="Record your first expense to track your outgoing operational costs."
          actionLabel="Record Expense"
          onAction={openNewModal}
        />
      ) : filteredExpenses.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          <p className="font-medium text-base text-gray-700">No matching expenses found</p>
          <p className="text-sm text-muted mt-1">Try adjusting your search query or category filter.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50/50">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {filteredExpenses.map(e => (
                <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50/80 transition-colors">
                  <td className="px-4 py-3.5 font-medium text-gray-900">{e.date}</td>
                  <td className="px-4 py-3.5">
                    <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-gray-100 text-gray-700">
                      {e.category}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-muted">{e.description || '-'}</td>
                  <td className="px-4 py-3.5 font-semibold text-red-600">−{formatCurrency(e.amount)}</td>
                  <td className="px-4 py-3.5 text-right">
                    <button onClick={() => handleEdit(e)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Edit"><Edit2 size={16} /></button>
                    <button onClick={() => {
                      setEntityToDelete({ id: e.id, name: `Expense for ${e.category}` });
                      setDeleteModalOpen(true);
                    }} className="p-1 text-gray-400 hover:text-red-600 ml-2 transition-colors" title="Delete"><Trash2 size={16} /></button>
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
    </div>
  );
};
