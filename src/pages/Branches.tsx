import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBranch, Branch } from '../context/BranchContext';
import { supabase } from '../lib/supabase';
import { Modal } from '../components/ui/Modal';
import {
  Building2,
  Plus,
  Edit2,
  Users,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Save,
  Loader2,
  Shield,
} from 'lucide-react';

interface BusinessUserRecord {
  id: string;
  user_id: string;
  role: string;
  branch_id: string | null;
  profile?: {
    full_name: string | null;
    email: string | null;
  };
  branches?: {
    name: string;
  } | null;
}

export const Branches: React.FC = () => {
  const { businessId, role } = useAuth();
  const { branches, refreshBranches, loading: branchLoading } = useBranch();

  const isAdmin = role === 'Creator' || role === 'Admin';

  const [activeTab, setActiveTab] = useState<'branches' | 'staff'>('branches');
  const [users, setUsers] = useState<BusinessUserRecord[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Branch Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    is_active: true,
  });

  const fetchUsers = useCallback(async () => {
    if (!businessId) return;
    setLoadingUsers(true);
    try {
      const { data, error } = await supabase
        .from('business_users')
        .select('id, user_id, role, branch_id, branches(name)')
        .eq('business_id', businessId)
        .order('role', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        // Fetch matching profiles
        const userIds = data.map(d => d.user_id);
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', userIds);

        const profileMap = new Map((profilesData || []).map(p => [p.id, p]));

        const combined: BusinessUserRecord[] = data.map(bu => ({
          ...bu,
          profile: profileMap.get(bu.user_id),
          branches: bu.branches as unknown as { name: string } | null,
        }));
        setUsers(combined);
      } else {
        setUsers([]);
      }
    } catch (err: any) {
      console.error('Error fetching business users:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (activeTab === 'staff') {
      fetchUsers();
    }
  }, [activeTab, fetchUsers]);

  const handleOpenAddModal = () => {
    setEditingBranch(null);
    setFormData({
      name: '',
      is_active: true,
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (branch: Branch) => {
    setEditingBranch(branch);
    setFormData({
      name: branch.name,
      is_active: branch.is_active,
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      setFormError('Branch name is required.');
      return;
    }

    if (!businessId) {
      setFormError('Business workspace missing. Please refresh.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        business_id: businessId,
        name: trimmedName,
        is_active: formData.is_active,
      };

      if (editingBranch) {
        const { error } = await supabase
          .from('branches')
          .update(payload)
          .eq('id', editingBranch.id)
          .eq('business_id', businessId);

        if (error) throw error;
        setStatusMessage({ type: 'success', text: `Branch "${trimmedName}" updated successfully.` });
      } else {
        const { error } = await supabase.from('branches').insert([payload]);
        if (error) throw error;
        setStatusMessage({ type: 'success', text: `Branch "${trimmedName}" created successfully.` });
      }

      setIsModalOpen(false);
      await refreshBranches();
    } catch (err: any) {
      console.error('Error saving branch:', err);
      setFormError(err.message || 'Failed to save branch.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignStaffBranch = async (businessUserRecordId: string, newBranchId: string | null) => {
    if (!businessId) return;
    setUpdatingUserId(businessUserRecordId);
    setStatusMessage(null);

    try {
      const { error } = await supabase
        .from('business_users')
        .update({ branch_id: newBranchId })
        .eq('id', businessUserRecordId)
        .eq('business_id', businessId);

      if (error) throw error;

      setStatusMessage({ type: 'success', text: 'Staff branch assignment updated successfully.' });
      await fetchUsers();
      await refreshBranches();
    } catch (err: any) {
      console.error('Error assigning staff branch:', err);
      setStatusMessage({ type: 'error', text: err.message || 'Failed to update branch assignment.' });
    } finally {
      setUpdatingUserId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7280' }}>
        <Shield size={36} color="#9CA3AF" style={{ margin: '0 auto 1rem' }} />
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#111827' }}>Access Restricted</h2>
        <p>Only Creators and Administrators can view and manage branch configurations.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building2 size={26} color="#2563EB" />
            Branch Management
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: '#6B7280', fontSize: '0.875rem' }}>
            Manage physical branches, operational status, and staff branch assignments.
          </p>
        </div>

        {activeTab === 'branches' && (
          <button
            onClick={handleOpenAddModal}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={16} />
            <span>Add Branch</span>
          </button>
        )}
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.875rem',
            background: statusMessage.type === 'success' ? '#F0FDF4' : '#FEF2F2',
            border: `1px solid ${statusMessage.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
            color: statusMessage.type === 'success' ? '#166534' : '#991B1B',
          }}
        >
          {statusMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #E5E7EB', paddingBottom: '2px' }}>
        <button
          onClick={() => setActiveTab('branches')}
          style={{
            padding: '8px 16px',
            borderRadius: '6px 6px 0 0',
            border: 'none',
            borderBottom: activeTab === 'branches' ? '2px solid #2563EB' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'branches' ? '#2563EB' : '#6B7280',
            fontWeight: activeTab === 'branches' ? 600 : 500,
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Branches ({branches.length})
        </button>
        <button
          onClick={() => setActiveTab('staff')}
          style={{
            padding: '8px 16px',
            borderRadius: '6px 6px 0 0',
            border: 'none',
            borderBottom: activeTab === 'staff' ? '2px solid #2563EB' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'staff' ? '#2563EB' : '#6B7280',
            fontWeight: activeTab === 'staff' ? 600 : 500,
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Staff Assignments
        </button>
      </div>

      {/* Tab 1: Branches List */}
      {activeTab === 'branches' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {branchLoading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#6B7280' }}>
              <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
              <p>Loading branches...</p>
            </div>
          ) : branches.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#6B7280' }}>
              <Building2 size={36} color="#9CA3AF" style={{ margin: '0 auto 12px' }} />
              <p style={{ fontWeight: 600, color: '#111827' }}>No branches configured yet</p>
              <p style={{ fontSize: '0.875rem', marginTop: '4px' }}>
                Add your primary branch (e.g. Pauh Jaya) to enable multi-branch tracking.
              </p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', color: '#4B5563', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '12px 16px' }}>Branch Name</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ fontSize: '0.875rem', color: '#111827' }}>
                {branches.map(b => (
                  <tr key={b.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '14px 16px', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Building2 size={16} color="#2563EB" />
                        <span>{b.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {b.is_active ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#166534', background: '#DCFCE7', padding: '3px 8px', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 500 }}>
                          <CheckCircle2 size={12} />
                          Active
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#991B1B', background: '#FEE2E2', padding: '3px 8px', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 500 }}>
                          <XCircle size={12} />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleOpenEditModal(b)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#2563EB',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '0.8125rem',
                          fontWeight: 500,
                        }}
                      >
                        <Edit2 size={14} />
                        <span>Edit</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 2: Staff Branch Assignments */}
      {activeTab === 'staff' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loadingUsers ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#6B7280' }}>
              <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
              <p>Loading team members...</p>
            </div>
          ) : users.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#6B7280' }}>
              <Users size={36} color="#9CA3AF" style={{ margin: '0 auto 12px' }} />
              <p style={{ fontWeight: 600, color: '#111827' }}>No team members found</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', color: '#4B5563', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '12px 16px' }}>Member</th>
                  <th style={{ padding: '12px 16px' }}>System Role</th>
                  <th style={{ padding: '12px 16px' }}>Branch Assignment</th>
                </tr>
              </thead>
              <tbody style={{ fontSize: '0.875rem', color: '#111827' }}>
                {users.map(u => {
                  const isStaff = u.role === 'Staff';
                  const isCreatorOrAdmin = u.role === 'Creator' || u.role === 'Admin';

                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600, color: '#111827' }}>
                          {u.profile?.full_name || 'User'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                          {u.profile?.email || '—'}
                        </div>
                      </td>

                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background:
                              u.role === 'Creator'
                                ? '#FEF3C7'
                                : u.role === 'Admin'
                                ? '#EFF6FF'
                                : '#F3F4F6',
                            color:
                              u.role === 'Creator'
                                ? '#92400E'
                                : u.role === 'Admin'
                                ? '#1D4ED8'
                                : '#374151',
                          }}
                        >
                          {u.role}
                        </span>
                      </td>

                      <td style={{ padding: '14px 16px' }}>
                        {isCreatorOrAdmin ? (
                          <span style={{ color: '#6B7280', fontSize: '0.8125rem', fontStyle: 'italic' }}>
                            Business-Wide (All Branches)
                          </span>
                        ) : isStaff ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <select
                              value={u.branch_id || ''}
                              onChange={e => handleAssignStaffBranch(u.id, e.target.value || null)}
                              disabled={updatingUserId === u.id}
                              className="input"
                              style={{ width: '220px', padding: '6px 10px', fontSize: '0.8125rem' }}
                            >
                              <option value="">-- Select Active Branch --</option>
                              {branches
                                .filter(b => b.is_active)
                                .map(b => (
                                  <option key={b.id} value={b.id}>
                                    {b.name}
                                  </option>
                                ))}
                            </select>
                            {updatingUserId === u.id && (
                              <Loader2 size={16} className="animate-spin text-blue-600" />
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#9CA3AF', fontSize: '0.8125rem' }}>
                            {u.branches?.name || 'All Branches (Read-Only)'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Branch Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingBranch ? 'Edit Branch' : 'Add New Branch'}
      >
        <form onSubmit={handleSaveBranch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {formError && (
            <div style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', color: '#991B1B', fontSize: '0.8125rem' }}>
              {formError}
            </div>
          )}

          <div>
            <label className="label">Branch Name *</label>
            <input
              type="text"
              required
              className="input"
              placeholder="e.g. Pauh Jaya or Kelisa Emas"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active}
              onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
              style={{ width: '16px', height: '16px' }}
            />
            <label htmlFor="is_active" style={{ fontSize: '0.875rem', fontWeight: 500, color: '#374151', cursor: 'pointer' }}>
              Active (Operational for students, classes, and payments)
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '1rem' }}>
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="btn btn-secondary"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              <span>{editingBranch ? 'Update Branch' : 'Create Branch'}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
