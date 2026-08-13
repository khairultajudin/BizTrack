import React, { useEffect, useState, useCallback } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/ui/Modal';
import { DeleteConfirmationModal } from '../components/ui/DeleteConfirmationModal';
import { Plus, Edit2, Trash2, GraduationCap } from 'lucide-react';
import { EmptyState } from '../core/ui/EmptyState';
import { formatCurrency } from '../lib/currency';

interface Staff {
  id: string;
  name: string;
  role: string;
  phone: string;
  salary_type: string;
  salary_amount: number;
}

export const Teachers: React.FC = () => {
  const { t, settings } = useTemplate();
  const { businessId, user } = useAuth();
  
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [entityToDelete, setEntityToDelete] = useState<{id: string, name: string} | null>(null);
  
  const [formData, setFormData] = useState({
    name: '', role: '', phone: '', salary_type: 'Monthly', salary_amount: 0
  });

  const fetchStaff = useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
      
    if (error) console.error(error);
    else setStaff(data || []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;

    if (editingId) {
      await supabase.from('staff').update(formData).eq('id', editingId);
    } else {
      await supabase.from('staff').insert([{ ...formData, business_id: businessId }]);
    }
    
    setIsModalOpen(false);
    fetchStaff();
  };

  const handleEdit = (member: Staff) => {
    setFormData({
      name: member.name, role: member.role || '', phone: member.phone || '', 
      salary_type: member.salary_type || 'Monthly', salary_amount: member.salary_amount || 0
    });
    setEditingId(member.id);
    setIsModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!businessId || !entityToDelete) return;
    const { error } = await supabase.from('staff')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id })
      .eq('id', entityToDelete.id)
      .eq('business_id', businessId);
      
    if (error) console.error(error);
    else fetchStaff();
    setDeleteModalOpen(false);
    setEntityToDelete(null);
  };

  const [searchQuery, setSearchQuery] = useState('');

  const filteredStaff = staff.filter(s => {
    return (
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.role && s.role.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (s.phone && s.phone.includes(searchQuery)) ||
      (s.salary_type && s.salary_type.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  });

  const openNewModal = () => {
    setFormData({ name: '', role: '', phone: '', salary_type: 'Monthly', salary_amount: 0 });
    setEditingId(null);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('teachers')}</h1>
          <p className="text-muted">Manage your staff and instructors.</p>
        </div>
        <button onClick={openNewModal} className="btn btn-primary">
          <Plus size={18} /> Add {t('teachers')}
        </button>
      </header>

      {/* Toolbar: Search */}
      {staff.length > 0 && (
        <div className="flex items-center bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder={`Search ${t('teachers').toLowerCase()}...`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input w-full pl-9 pr-4 text-sm"
            />
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
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
      ) : staff.length === 0 ? (
        <EmptyState 
          icon={GraduationCap} 
          title={`No ${t('teachers').toLowerCase()} yet`} 
          description={`Add your first ${t('teachers').toLowerCase()} to start assigning them to ${t('classes').toLowerCase()} and managing payroll.`}
          actionLabel={`Add ${t('teachers')}`}
          onAction={openNewModal}
        />
      ) : filteredStaff.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          <p className="font-medium text-base text-gray-700">No matching {t('teachers').toLowerCase()} found</p>
          <p className="text-sm text-muted mt-1">Try adjusting your search query.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50/50">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Salary Type</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {filteredStaff.map(s => (
                <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50/80 transition-colors">
                  <td className="px-4 py-3.5 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3.5">{s.role || '-'}</td>
                  <td className="px-4 py-3.5 text-muted">{s.phone || '-'}</td>
                  <td className="px-4 py-3.5">{s.salary_type}</td>
                  <td className="px-4 py-3.5 font-medium">{formatCurrency(s.salary_amount)}</td>
                  <td className="px-4 py-3.5 text-right">
                    <button onClick={() => handleEdit(s)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Edit"><Edit2 size={16} /></button>
                    <button onClick={() => {
                          setEntityToDelete({ id: s.id, name: s.name });
                          setDeleteModalOpen(true);
                        }} className="p-1 text-gray-400 hover:text-red-600 ml-2 transition-colors" title="Delete"><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? `Edit ${t('teachers')}` : `New ${t('teachers')}`}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="input-group">
            <label className="input-label">Name</label>
            <input required type="text" className="input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          </div>
          <div className="input-group">
            <label className="input-label">Role</label>
            <input type="text" className="input" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} />
          </div>
          <div className="input-group">
            <label className="input-label">Phone</label>
            <input type="text" className="input" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="input-group">
              <label className="input-label">Salary Type</label>
              <select className="input bg-white" value={formData.salary_type} onChange={e => setFormData({...formData, salary_type: e.target.value})}>
                <option value="Monthly">Monthly</option>
                <option value="Hourly">Hourly</option>
                <option value="Commission">Commission</option>
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Amount (RM)</label>
              <input type="number" required className="input" value={formData.salary_amount} onChange={e => setFormData({...formData, salary_amount: Number(e.target.value)})} />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn btn-ghost">Cancel</button>
            <button type="submit" className="btn btn-primary">{editingId ? 'Update' : 'Create'}</button>
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
