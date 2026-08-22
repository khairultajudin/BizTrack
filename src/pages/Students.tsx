import React, { useEffect, useState, useCallback } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/ui/Modal';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import { Plus, Edit2, Trash2, Users, AlertCircle, Search } from 'lucide-react';
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
      supabase.from('customers').select('*, groups(name)').eq('business_id', businessId).order('created_at', { ascending: false }),
      supabase.from('groups').select('id, name').eq('business_id', businessId)
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
      status: customer.status || 'Active'
    });
    setEditingId(customer.id);
    setIsModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!businessId || !entityToDelete) return;
    const { error } = await supabase.from('customers')
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
      <header className="page-header">
        <div>
          <h1>{t('students')}</h1>
          <p className="text-muted">Manage your students and class assignments.</p>
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
              placeholder="Search students..."
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
        <div className="card p-12 text-center text-gray-500 flex justify-center items-center">
          <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
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
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map(c => (
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
                      <span className="badge badge-blue">
                        {c.groups.name}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="text-right primary-text">
                    {formatCurrency(c.monthly_fee)}
                  </td>
                  <td>
                    <span className={`badge ${c.status === 'Active' ? 'badge-success' : 'badge-archived'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="action-buttons-group">
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

