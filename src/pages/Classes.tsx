import React, { useEffect, useState, useCallback } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/ui/Modal';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import { Plus, Edit2, Trash2, Users, BookOpen } from 'lucide-react';
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
  const { t, settings } = useTemplate();
  const { businessId, user } = useAuth();
  
  const [groups, setGroups] = useState<Group[]>([]);
  const [teachers, setTeachers] = useState<{id: string, name: string}[]>([]);
  const [loading, setLoading] = useState(true);
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
      supabase.from('groups').select('*, staff(name)').eq('business_id', businessId).is('deleted_at', null).order('created_at', { ascending: false }),
      supabase.from('staff').select('id, name').eq('business_id', businessId).is('deleted_at', null)
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
    if (!businessId) return;

    const payload = {
      ...formData,
      teacher_id: formData.teacher_id || null,
      business_id: businessId
    };

    if (editingId) {
      await supabase.from('groups').update(payload).eq('id', editingId);
    } else {
      await supabase.from('groups').insert([payload]);
    }
    
    setIsModalOpen(false);
    fetchData();
  };

  const handleEdit = (group: Group) => {
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

  const filteredGroups = groups.filter(g => {
    const matchesSearch = 
      g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (g.staff?.name && g.staff.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (g.description && g.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === 'All' || g.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openNewModal = () => {
    setFormData({ name: '', teacher_id: '', monthly_fee: 0, max_students: 20, status: 'Active', description: '' });
    setEditingId(null);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('classes')}</h1>
          <p className="text-muted">Manage your {t('classes').toLowerCase()} and assign {t('teachers').toLowerCase()}.</p>
        </div>
        <button onClick={openNewModal} className="btn btn-primary">
          <Plus size={18} /> Add {t('classes')}
        </button>
      </header>

      {/* Toolbar: Search and Filter */}
      {groups.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder={`Search ${t('classes').toLowerCase()}...`}
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
              <option value="Archived">Archived</option>
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
      ) : groups.length === 0 ? (
        <EmptyState 
          icon={BookOpen} 
          title={`No ${t('classes').toLowerCase()} yet`} 
          description={`Add your first ${t('classes').toLowerCase()} to start assigning ${t('teachers').toLowerCase()} and enrolling students.`}
          actionLabel={`Add ${t('classes')}`}
          onAction={openNewModal}
        />
      ) : filteredGroups.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          <p className="font-medium text-base text-gray-700">No matching {t('classes').toLowerCase()} found</p>
          <p className="text-sm text-muted mt-1">Try adjusting your search query or filter settings.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50/50">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">{t('teachers')}</th>
                <th className="px-4 py-3 font-medium">Fee</th>
                <th className="px-4 py-3 font-medium">Capacity</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {filteredGroups.map(g => (
                <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50/80 transition-colors">
                  <td className="px-4 py-3.5 font-medium text-gray-900">{g.name}</td>
                  <td className="px-4 py-3.5">{g.staff?.name || '-'}</td>
                  <td className="px-4 py-3.5 font-medium">{formatCurrency(g.monthly_fee)}</td>
                  <td className="px-4 py-3.5 flex items-center gap-1.5"><Users size={14} className="text-gray-400"/> {g.max_students}</td>
                  <td className="px-4 py-3.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${g.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                      {g.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <button onClick={() => handleEdit(g)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Edit"><Edit2 size={16} /></button>
                    <button onClick={() => {
                        setEntityToDelete({ id: g.id, name: g.name });
                        setDeleteModalOpen(true);
                      }} className="p-1 text-gray-400 hover:text-red-600 ml-2 transition-colors" title="Delete"><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? `Edit ${t('classes')}` : `New ${t('classes')}`}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="input-group">
            <label className="input-label">Name</label>
            <input required type="text" className="input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          </div>
          
          <div className="input-group">
            <label className="input-label">Assign {t('teachers')}</label>
            <select className="input bg-white" value={formData.teacher_id} onChange={e => setFormData({...formData, teacher_id: e.target.value})}>
              <option value="">-- None --</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Monthly Fee (RM)</label>
              <input type="number" required className="input" value={formData.monthly_fee} onChange={e => setFormData({...formData, monthly_fee: Number(e.target.value)})} />
            </div>
            <div className="input-group">
              <label className="input-label">Max Capacity</label>
              <input type="number" required className="input" value={formData.max_students} onChange={e => setFormData({...formData, max_students: Number(e.target.value)})} />
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Status</label>
            <select className="input bg-white" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
              <option value="Active">Active</option>
              <option value="Archived">Archived</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn btn-ghost">Cancel</button>
            <button type="submit" className="btn btn-primary w-full">{editingId ? 'Update' : 'Create'}</button>
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
