import React, { useEffect, useState, useCallback } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/ui/Modal';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import { Plus, Edit2, Trash2, Users, BookOpen, AlertCircle, Search, Loader2 } from 'lucide-react';
import { EmptyState } from '../core/ui/EmptyState';
import { formatCurrency } from '../lib/currency';

interface Group {
  id: string;
  name: string;
  teacher_id: string | null;
  monthly_fee: number;
  max_students: number;
  status: string;
  description: string;
  staff?: { name: string };
}

export const Classes: React.FC = () => {
  const { t } = useTemplate();
  const { businessId, user } = useAuth();
  
  const [groups, setGroups] = useState<Group[]>([]);
  const [teachers, setTeachers] = useState<{id: string, name: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [entityToDelete, setEntityToDelete] = useState<{id: string, name: string} | null>(null);
  
  const [formData, setFormData] = useState({
    name: '', teacher_id: '', monthly_fee: 0, max_students: 20, status: 'Active', description: ''
  });

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    const [groupsRes, teachersRes] = await Promise.all([
      supabase.from('groups').select('*, staff(name)').eq('business_id', businessId).order('created_at', { ascending: false }),
      supabase.from('staff').select('id, name').eq('business_id', businessId)
    ]);
    
    if (groupsRes.data) setGroups(groupsRes.data);
    if (teachersRes.data) setTeachers(teachersRes.data);
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
      setFormError('Class name is required.');
      return;
    }

    setSubmitting(true);

    const payload = {
      name: nameTrimmed,
      teacher_id: formData.teacher_id || null,
      monthly_fee: isNaN(Number(formData.monthly_fee)) ? 0 : Number(formData.monthly_fee),
      max_students: isNaN(Number(formData.max_students)) ? 20 : Number(formData.max_students),
      status: formData.status || 'Active',
      description: formData.description.trim() || null,
      business_id: businessId
    };

    try {
      let saveError: any = null;

      if (editingId) {
        const { error } = await supabase
          .from('groups')
          .update(payload)
          .eq('id', editingId)
          .eq('business_id', businessId);
        saveError = error;
      } else {
        const { error } = await supabase
          .from('groups')
          .insert([payload]);
        saveError = error;
      }

      if (saveError) {
        console.error('Supabase error saving class:', {
          message: saveError.message,
          details: saveError.details,
          hint: saveError.hint,
          code: saveError.code,
          fullError: saveError
        });
        setFormError(saveError.message || 'Unable to save class record. Please check your input.');
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

  const handleEdit = (group: Group) => {
    setFormError(null);
    setFormData({
      name: group.name, 
      teacher_id: group.teacher_id || '', 
      monthly_fee: group.monthly_fee || 0, 
      max_students: group.max_students || 20,
      status: group.status || 'Active',
      description: group.description || ''
    });
    setEditingId(group.id);
    setIsModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!businessId || !entityToDelete) return;
    const { error } = await supabase.from('groups')
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

  const filteredGroups = groups.filter(g => {
    const matchesSearch = 
      g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (g.staff?.name && g.staff.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (g.description && g.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === 'All' || g.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openNewModal = () => {
    setFormError(null);
    setFormData({ name: '', teacher_id: '', monthly_fee: 0, max_students: 20, status: 'Active', description: '' });
    setEditingId(null);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="page-header">
        <div>
          <h1>{t('classes')}</h1>
          <p className="text-muted">Organize your classes and assign teachers.</p>
        </div>
        <button onClick={openNewModal} className="btn btn-primary">
          <Plus size={18} /> Add Class
        </button>
      </header>

      {/* Toolbar: Search and Filter */}
      {groups.length > 0 && (
        <div className="management-toolbar">
          <div className="search-input-wrapper">
            <span className="search-icon">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Search classes..."
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
              <option value="Archived">Archived</option>
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-state-card">
          <Loader2 size={28} className="loading-spinner" />
          <span>Loading classes...</span>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState 
          icon={BookOpen} 
          title="No classes yet" 
          description="Create your first class (e.g. Year 2, Form 1) to organize students and assign teachers."
          actionLabel="Add Class"
          onAction={openNewModal}
        >
          <div className="guide-box">
            <span style={{ fontWeight: 600 }}>💡 Recommended Setup Sequence:</span>
            <div className="guide-steps-flow">
              <span className="guide-step">1. Add Teachers</span>
              <span>➔</span>
              <span className="guide-step highlight">2. Create Classes</span>
              <span>➔</span>
              <span className="guide-step">3. Add Students</span>
              <span>➔</span>
              <span className="guide-step">4. Payments</span>
            </div>
          </div>
        </EmptyState>
      ) : filteredGroups.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          <p className="font-medium text-base text-gray-700">No matching classes found</p>
          <p className="text-sm text-muted mt-1">Try adjusting your search query or filter settings.</p>
        </div>
      ) : (
        <div className="card-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Teacher</th>
                <th className="text-right">Monthly Fee</th>
                <th>Capacity</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map(g => (
                <tr key={g.id}>
                  <td className="primary-text">{g.name}</td>
                  <td>{g.staff?.name || <span className="text-muted">—</span>}</td>
                  <td className="text-right primary-text">{formatCurrency(g.monthly_fee)}</td>
                  <td>
                    <span className="badge" style={{ color: '#4B5563' }}>
                      <Users size={14} style={{ color: '#9CA3AF' }} /> {g.max_students}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${g.status === 'Active' ? 'badge-success' : 'badge-archived'}`}>
                      {g.status}
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="action-buttons-group">
                      <button
                        onClick={() => handleEdit(g)}
                        className="action-btn edit"
                        title="Edit Class"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => {
                          setEntityToDelete({ id: g.id, name: g.name });
                          setDeleteModalOpen(true);
                        }}
                        className="action-btn delete"
                        title="Delete Class"
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

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? `Edit ${t('classes')}` : `Add New ${t('classes')}`}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-xs text-muted -mt-1">Create a learning class or grade level for your tuition centre (e.g. Year 2, Form 1, Standard 3).</p>

          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-red-800">Unable to save class</p>
                <p className="text-xs text-red-600 mt-0.5">{formError}</p>
              </div>
            </div>
          )}

          <div className="input-group">
            <label className="input-label">Class Name</label>
            <input required type="text" className="input text-base sm:text-sm" value={formData.name} onChange={e => { setFormError(null); setFormData({...formData, name: e.target.value}); }} placeholder="e.g. Year 2, Form 1, Standard 3" />
          </div>
          
          <div className="input-group">
            <label className="input-label">Assign {t('teachers')}</label>
            <select className="input bg-white text-base sm:text-sm" value={formData.teacher_id} onChange={e => { setFormError(null); setFormData({...formData, teacher_id: e.target.value}); }}>
              <option value="">-- None --</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {teachers.length === 0 ? (
              <p className="text-xs text-amber-600 mt-1">
                No teachers added yet. You can create a teacher from the <a href="/teachers" className="underline font-medium text-amber-700 hover:text-amber-900">Teachers page</a> first, or assign one later.
              </p>
            ) : (
              <p className="text-xs text-muted mt-1">
                Optional. Select a teacher or leave as "-- None --".
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Monthly Fee (RM)</label>
              <input type="number" required min="0" step="any" className="input text-base sm:text-sm" value={formData.monthly_fee} onChange={e => { setFormError(null); setFormData({...formData, monthly_fee: Number(e.target.value)}); }} />
            </div>
            <div className="input-group">
              <label className="input-label">Max Capacity</label>
              <input type="number" required min="1" className="input text-base sm:text-sm" value={formData.max_students} onChange={e => { setFormError(null); setFormData({...formData, max_students: Number(e.target.value)}); }} />
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Status</label>
            <select className="input bg-white text-base sm:text-sm" value={formData.status} onChange={e => { setFormError(null); setFormData({...formData, status: e.target.value}); }}>
              <option value="Active">Active</option>
              <option value="Archived">Archived</option>
            </select>
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
          entityType="class"
          entityId={entityToDelete.id}
          entityName={entityToDelete.name}
          businessId={businessId}
        />
      )}
    </div>
  );
};

