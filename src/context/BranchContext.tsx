import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

export interface Branch {
  id: string;
  business_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

interface BranchContextType {
  branches: Branch[];
  activeBranches: Branch[];
  selectedBranchId: string | null; // null represents "All Branches" (if allowed)
  selectedBranch: Branch | null;
  isMultiBranch: boolean;
  canSelectAll: boolean;
  isStaff: boolean;
  staffBranchId: string | null;
  loading: boolean;
  setSelectedBranchId: (id: string | null) => void;
  refreshBranches: () => Promise<void>;
}

export const BranchContext = createContext<BranchContextType>({
  branches: [],
  activeBranches: [],
  selectedBranchId: null,
  selectedBranch: null,
  isMultiBranch: false,
  canSelectAll: true,
  isStaff: false,
  staffBranchId: null,
  loading: true,
  setSelectedBranchId: () => {},
  refreshBranches: async () => {},
});

export const BranchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { businessId, role, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [staffBranchId, setStaffBranchId] = useState<string | null>(null);

  const canSelectAll = role === 'Creator' || role === 'Admin';

  const [selectedBranchIdState, setSelectedBranchIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && businessId) {
      const saved = localStorage.getItem(`biztrack_branch_${businessId}`);
      return saved && saved !== 'ALL' ? saved : null;
    }
    return null;
  });

  // Fetch branches and current staff assignment
  const refreshBranches = useCallback(async () => {
    if (!businessId) {
      setBranches([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [branchesRes, userRes] = await Promise.all([
        supabase
          .from('branches')
          .select('*')
          .eq('business_id', businessId)
          .order('name', { ascending: true }),
        user
          ? supabase
              .from('business_users')
              .select('branch_id, role')
              .eq('business_id', businessId)
              .eq('user_id', user.id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (branchesRes.data) {
        setBranches(branchesRes.data as Branch[]);
      } else {
        setBranches([]);
      }

      if (userRes.data?.role === 'Staff' && userRes.data?.branch_id) {
        setStaffBranchId(userRes.data.branch_id);
      } else {
        setStaffBranchId(null);
      }
    } catch (err) {
      console.error('[BranchContext] Error fetching branches:', err);
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, user]);

  useEffect(() => {
    refreshBranches();
  }, [refreshBranches]);

  const activeBranches = useMemo(() => {
    return branches.filter(b => b.is_active);
  }, [branches]);

  const isMultiBranch = branches.length > 0;

  // Resolve actual selected branch ID considering staff locks
  const selectedBranchId = useMemo(() => {
    // If user is Staff with an assigned branch, lock to their branch
    if (role === 'Staff' && staffBranchId) {
      return staffBranchId;
    }

    // If Creator/Admin, use state if it matches an existing active branch
    if (selectedBranchIdState && branches.some(b => b.id === selectedBranchIdState)) {
      return selectedBranchIdState;
    }

    // Default to null ("All Branches") for Creator/Admin
    return null;
  }, [role, staffBranchId, selectedBranchIdState, branches]);

  const selectedBranch = useMemo(() => {
    if (!selectedBranchId) return null;
    return branches.find(b => b.id === selectedBranchId) || null;
  }, [selectedBranchId, branches]);

  const setSelectedBranchId = useCallback((id: string | null) => {
    if (role === 'Staff' && staffBranchId) {
      // Staff cannot switch branches
      return;
    }

    setSelectedBranchIdState(id);
    if (typeof window !== 'undefined' && businessId) {
      if (id) {
        localStorage.setItem(`biztrack_branch_${businessId}`, id);
      } else {
        localStorage.removeItem(`biztrack_branch_${businessId}`);
      }
    }
  }, [role, staffBranchId, businessId]);

  const isStaff = role === 'Staff';

  return (
    <BranchContext.Provider
      value={{
        branches,
        activeBranches,
        selectedBranchId,
        selectedBranch,
        isMultiBranch,
        canSelectAll,
        isStaff,
        staffBranchId,
        loading,
        setSelectedBranchId,
        refreshBranches,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useBranch = () => useContext(BranchContext);
