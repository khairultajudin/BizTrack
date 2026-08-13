import React, { useEffect, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  entityType: 'student' | 'class' | 'teacher' | 'payment' | 'expense';
  entityId: string;
  entityName: string;
  businessId: string;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  entityType,
  entityId,
  entityName,
}) => {
  const [impact, setImpact] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && entityId) {
      analyzeImpact();
    }
  }, [isOpen, entityId]);

  const analyzeImpact = async () => {
    setLoading(true);
    const impacts: string[] = [];

    try {
      if (entityType === 'student') {
        const { count } = await supabase.from('payments').select('*', { count: 'exact', head: true }).eq('customer_id', entityId).is('deleted_at', null);
        if (count && count > 0) impacts.push(`This will hide ${count} payment records associated with this student.`);
      }

      if (entityType === 'class') {
        const { count } = await supabase.from('customers').select('*', { count: 'exact', head: true }).eq('assigned_group_id', entityId).is('deleted_at', null);
        if (count && count > 0) impacts.push(`This will unassign ${count} active students from this class.`);
      }

      if (entityType === 'teacher') {
        const { count } = await supabase.from('groups').select('*', { count: 'exact', head: true }).eq('teacher_id', entityId).is('deleted_at', null);
        if (count && count > 0) impacts.push(`This will unassign the teacher from ${count} active classes.`);
      }

      setImpact(impacts);
    } catch (e) {
      console.error('Impact analysis failed', e);
    }

    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100] animate-in fade-in">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-red-50">
          <h2 className="text-lg font-bold text-red-700 flex items-center gap-2">
            <AlertTriangle size={20} />
            Confirm Deletion
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-red-100 rounded-md text-red-500 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6">
          <p className="text-gray-700 mb-4">
            Are you sure you want to delete <span className="font-bold">{entityName}</span>?
          </p>

          {loading ? (
            <p className="text-sm text-muted">Analyzing impact...</p>
          ) : impact.length > 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg flex flex-col gap-2 mb-4">
              <span className="text-sm font-bold text-yellow-800">Impact Analysis:</span>
              <ul className="list-disc pl-5 text-sm text-yellow-700 flex flex-col gap-1">
                {impact.map((imp, i) => <li key={i}>{imp}</li>)}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted mb-4">This action will soft-delete the record. No financial history will be permanently lost.</p>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors flex items-center gap-2"
            >
              <Trash2 size={16} />
              Yes, Archive Record
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
