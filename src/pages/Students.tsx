import React, { useEffect, useState, useCallback } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/ui/Modal';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import { Plus, Edit2, Trash2, Users, AlertCircle } from 'lucide-react';
import { EmptyState } from '../core/ui/EmptyState';
import { formatCurrency } from '../lib/currency';

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

export const Students: React.FC = () => {
  const { t } = useTemplate();
  const { businessId, user } = useAuth();
  
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [groups, setGroups] = useState<{id: string, name: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [entityToDelete, setEntityToDelete] = useState<{id: string, name: string} | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '', phone: '', email: '', assigned_group_id: '', monthly_fee: 0, status: 'Active'
  });

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    const [customersRes, groupsRes] = await Promise.all([
      supabase.from('customers').select('*, groups(name)').eq('business_id', businessId).is('deleted_at', null).order('created_at', { ascending: false }),
      supabase.from('groups').select('id, name').eq('business_id', businessId).is('deleted_at', null)
    ]);
    
    if (customersRes.data) setCustomers(customersRes.data);
    if (groupsRes.data) setGroups(groupsRes.data);
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
      assigned_group_id: formData.assigned_group_id && formData.assigned_group_id !== 'none' ? formData.assigned_group_id : null,
      monthly_fee: isNaN(Number(formData.monthly_fee)) ? 0 : Number(formData.monthly_fee),
      status: formData.status || 'Active',
      business_id: businessId
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
        const { error } = await supabase
          .from('customers')
          .insert([payload]);
        saveError = error;
      }

      if (saveError) {
        console.error('Supabase error saving student:', {
          message: saveError.message,
          details: saveError.details,
          hint: saveError.hint,
          code: saveError.code,
          fullError: saveError
        });
        setFormError(saveError.message || 'Unable to save student. Please check your input and try again.');
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
      status: customer.status || 'Active'
    });
    setEditingId(customer.id);
    setIsModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!businessId || !entityToDelete) return;
    const { error } = await supabase.from('customers')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id })
      .eq('id', entityToDelete.id)
      .eq('business_id', businessId);
      
    if (error) console.error(error);
    else fetchData();
    setEntityToDelete(null);
    setDeleteModalOpen(false);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const filteredCustomers = customers.filter(c => {
    const matchesSearch = 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.phone && c.phone.includes(searchQuery)) ||
      (c.email && c.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.groups?.name && c.groups.name.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesStatus = statusFilter === 'All' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openNewModal = () => {
    setFormError(null);
    setFormData({ name: '', phone: '', email: '', assigned_group_id: '', monthly_fee: 0, status: 'Active' });
    setEditingId(null);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('students')}</h1>
          <p className="text-muted">Manage your {t('students').toLowerCase()} directory.</p>
        </div>
        <button onClick={openNewModal} className="btn btn-primary">
          <Plus size={18} /> Add {t('students')}
        </button>
      </header>

      {/* Toolbar: Search and Filter */}
      {customers.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder={`Search ${t('students').toLowerCase()}...`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input w-full pl-9 pr-4 text-sm"
            />
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs text-muted font-medium whitespace-nowrap">Filter Status:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="input text-sm py-1.5 bg-white cursor-pointer"
            >
              <option value="All">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-12 text-center text-gray-500 flex justify-center items-center">
          <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      ) : customers.length === 0 ? (
        <EmptyState 
          icon={Users} 
          title={`No ${t('students').toLowerCase()} yet`} 
          description={`Add your first ${t('students').toLowerCase()} to start recording monthly payments and organizing classes.`}
          actionLabel={`Add ${t('students')}`}
          onAction={openNewModal}
        >
          <div className="bg-blue-50/80 border border-blue-100 rounded-lg p-3 text-left text-xs text-blue-900 flex flex-col gap-1.5">
            <span className="font-semibold text-blue-800">💡 Recommended Setup Sequence:</span>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-blue-700">
              <span className="bg-white px-2 py-0.5 rounded border border-blue-200">1. Add Teachers</span>
              <span>➔</span>
              <span className="bg-white px-2 py-0.5 rounded border border-blue-200">2. Create Classes (e.g. Year 2)</span>
              <span>➔</span>
              <span className="font-medium bg-white px-2 py-0.5 rounded border border-blue-300 text-blue-900">3. Add Students</span>
              <span>➔</span>
              <span className="bg-white px-2 py-0.5 rounded border border-blue-200">4. Payments</span>
            </div>
          </div>
        </EmptyState>
      ) : filteredCustomers.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          <p className="font-medium text-base text-gray-700">No matching {t('students').toLowerCase()} found</p>
          <p className="text-sm text-muted mt-1">Try adjusting your search query or filter settings.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50/50">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">{t('classes')}</th>
                <th className="px-4 py-3 font-medium">Fee</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {filteredCustomers.map(c => (
                <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50/80 transition-colors">
                  <td className="px-4 py-3.5 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3.5 text-muted">{c.phone || '-'}{c.email ? <><br/>{c.email}</> : ''}</td>
                  <td className="px-4 py-3.5">{c.groups?.name || '-'}</td>
                  <td className="px-4 py-3.5 font-medium">{formatCurrency(c.monthly_fee)}</td>
                  <td className="px-4 py-3.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${c.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <button onClick={() => handleEdit(c)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Edit"><Edit2 size={16} /></button>
                    <button onClick={() => {
                          setEntityToDelete({ id: c.id, name: c.name });
                          setDeleteModalOpen(true);
                        }} className="p-1 text-gray-400 hover:text-red-600 ml-2 transition-colors" title="Delete"><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? `Edit ${t('students')}` : `Add New ${t('students')}`}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-xs text-muted -mt-1">Enter student details and optionally assign them to an existing class (e.g. Year 2).</p>

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
            <input required type="text" className="input text-base sm:text-sm" value={formData.name} onChange={e => { setFormError(null); setFormData({...formData, name: e.target.value}); }} placeholder="e.g. Ali bin Ahmad" />
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Phone</label>
              <input type="text" className="input text-base sm:text-sm" value={formData.phone} onChange={e => { setFormError(null); setFormData({...formData, phone: e.target.value}); }} placeholder="e.g. 0123456789" />
            </div>
            <div className="input-group">
              <label className="input-label">Email</label>
              <input type="email" className="input text-base sm:text-sm" value={formData.email} onChange={e => { setFormError(null); setFormData({...formData, email: e.target.value}); }} placeholder="e.g. student@example.com" />
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Assign to {t('classes')}</label>
            <select className="input bg-white text-base sm:text-sm" value={formData.assigned_group_id} onChange={e => { setFormError(null); setFormData({...formData, assigned_group_id: e.target.value}); }}>
              <option value="">-- None --</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            {groups.length === 0 ? (
              <p className="text-xs text-amber-600 mt-1">
                No active classes found. To assign a class like "Year 2", create it from the <a href="/classes" className="underline font-medium text-amber-700 hover:text-amber-900">Classes page</a> first, or leave as "-- None --".
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
              <input type="number" required min="0" step="any" className="input text-base sm:text-sm" value={formData.monthly_fee} onChange={e => { setFormError(null); setFormData({...formData, monthly_fee: Number(e.target.value)}); }} />
            </div>
            <div className="input-group">
              <label className="input-label">Status</label>
              <select className="input bg-white text-base sm:text-sm" value={formData.status} onChange={e => { setFormError(null); setFormData({...formData, status: e.target.value}); }}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
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
          entityType="student"
          entityId={entityToDelete.id}
          entityName={entityToDelete.name}
          businessId={businessId}
        />
      )}
    </div>
  );
};

