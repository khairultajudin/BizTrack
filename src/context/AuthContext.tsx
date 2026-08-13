import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// ─── Profile shape (mirrors public.profiles) ─────────────────────────────────
export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  job_title: string | null;
  timezone: string | null;
  language: string | null;
  avatar_url: string | null;
}

// ─── Context shape ────────────────────────────────────────────────────────────
interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;

  // Identity — computed once here, consumed everywhere
  displayName: string;    // Full Name → auth metadata name → email prefix → 'User'
  initials: string;       // e.g. "KT" for "Khairul Tajudin"

  businessId: string | null;
  businessName: string | null;
  role: string | null;

  refreshAuth: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resolveDisplayName(profile: UserProfile | null, user: User | null): string {
  // 1. profiles.full_name (user-editable source of truth)
  if (profile?.full_name?.trim()) return profile.full_name.trim();
  // 2. auth metadata full_name (set during sign-up)
  const metaName = user?.user_metadata?.full_name as string | undefined;
  if (metaName?.trim()) return metaName.trim();
  // 3. email prefix
  if (user?.email) return user.email.split('@')[0];
  return 'User';
}

function resolveInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// ─── Context default ──────────────────────────────────────────────────────────
export const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  displayName: 'User',
  initials: 'U',
  businessId: null,
  businessName: null,
  role: null,
  refreshAuth: async () => {},
  refreshProfile: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  // ── Fetch profile row ────────────────────────────────────────────────────
  const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, phone, job_title, timezone, language, avatar_url')
      .eq('id', userId)
      .maybeSingle();
    if (error) console.error('[AuthContext] fetchProfile error:', error);
    return data as UserProfile | null;
  }, []);

  // ── Fetch business membership ─────────────────────────────────────────────
  const fetchBusiness = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('business_users')
      .select('business_id, role, businesses(name)')
      .eq('user_id', userId)
      .single();
    if (error) {
      console.error('[AuthContext] fetchBusiness error:', error);
      return;
    }
    if (data) {
      setBusinessId(data.business_id);
      setRole(data.role);
      const biz = data.businesses as unknown as { name: string } | null;
      setBusinessName(biz?.name ?? null);
    }
  }, []);

  // ── Master load (both in parallel) ───────────────────────────────────────
  const fetchAll = useCallback(async (userId: string) => {
    try {
      const [prof] = await Promise.all([
        fetchProfile(userId),
        fetchBusiness(userId),
      ]);
      setProfile(prof);
    } catch (err) {
      console.error('[AuthContext] fetchAll error:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchProfile, fetchBusiness]);

  // ── Auth state ────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        fetchAll(u.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        fetchAll(u.id);
      } else {
        setProfile(null);
        setBusinessId(null);
        setBusinessName(null);
        setRole(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchAll]);

  // ── Public refresh helpers ────────────────────────────────────────────────
  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const prof = await fetchProfile(user.id);
    setProfile(prof);
  }, [user, fetchProfile]);

  const refreshAuth = useCallback(async () => {
    if (!user) return;
    await fetchAll(user.id);
  }, [user, fetchAll]);

  // ── Derived identity (computed once, used everywhere) ─────────────────────
  const displayName = resolveDisplayName(profile, user);
  const initials = resolveInitials(displayName);

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      loading,
      displayName,
      initials,
      businessId,
      businessName,
      role,
      refreshAuth,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
