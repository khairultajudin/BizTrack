import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { User, Mail, Phone, Briefcase, Globe, Lock, CheckCircle, Camera, Clock, Shield } from 'lucide-react';

const TIMEZONES = [
  'Asia/Kuala_Lumpur',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Manila',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'UTC',
  'Europe/London',
  'America/New_York',
];

const LANGUAGES = [
  { value: 'en-MY', label: 'English (Malaysia)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'ms-MY', label: 'Bahasa Melayu' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
  { value: 'ta-IN', label: 'Tamil' },
];

export const MyProfile: React.FC = () => {
  const { user, profile, displayName, initials, refreshProfile } = useAuth();

  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  // Profile form state
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    job_title: '',
    timezone: 'Asia/Kuala_Lumpur',
    language: 'en-MY',
  });

  // Password form state
  const [pwForm, setPwForm] = useState({
    newPassword: '',
    confirmPassword: '',
  });

  // Hydrate form when profile loads
  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name || '',
        phone: profile.phone || '',
        job_title: profile.job_title || '',
        timezone: profile.timezone || 'Asia/Kuala_Lumpur',
        language: profile.language || 'en-MY',
      });
    }
  }, [profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        full_name: form.full_name.trim() || null,
        phone: form.phone.trim() || null,
        job_title: form.job_title.trim() || null,
        timezone: form.timezone,
        language: form.language,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSaveSuccess(true);
      // Refresh AuthContext so displayName updates everywhere instantly
      await refreshProfile();
      setTimeout(() => setSaveSuccess(false), 4000);
    }
    setSaving(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);

    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('Passwords do not match.');
      return;
    }
    if (pwForm.newPassword.length < 6) {
      setPwError('Password must be at least 6 characters.');
      return;
    }

    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: pwForm.newPassword });
    if (error) {
      setPwError(error.message);
    } else {
      setPwSuccess(true);
      setPwForm({ newPassword: '', confirmPassword: '' });
      setTimeout(() => setPwSuccess(false), 4000);
    }
    setChangingPassword(false);
  };

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

      {/* ── Page header ── */}
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#111827', margin: 0 }}>
          My Profile
        </h1>
        <p style={{ fontSize: '0.85rem', color: '#9CA3AF', margin: '0.25rem 0 0' }}>
          Manage your personal information and account settings.
        </p>
      </div>

      {/* ── Avatar & identity card ── */}
      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          {/* Avatar */}
          <div style={{ position: 'relative' }}>
            <div style={S.avatar}>
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={displayName}
                  style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                />
              ) : (
                <span style={S.avatarInitials}>{initials}</span>
              )}
            </div>
            <div style={S.avatarEditBadge} title="Profile photo upload coming soon">
              <Camera size={12} color="white" />
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '1.15rem', fontWeight: 700, color: '#111827', margin: 0 }}>
              {displayName}
            </p>
            <p style={{ fontSize: '0.825rem', color: '#6B7280', margin: '0.15rem 0 0' }}>
              {user?.email}
            </p>
            {form.job_title && (
              <p style={{ fontSize: '0.775rem', color: '#9CA3AF', margin: '0.1rem 0 0' }}>
                {form.job_title}
              </p>
            )}
            <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Clock size={12} color="#9CA3AF" />
                <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>
                  Member since {user?.created_at
                    ? new Date(user.created_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Shield size={12} color="#9CA3AF" />
                <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>
                  Last login {user?.last_sign_in_at
                    ? new Date(user.last_sign_in_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Profile form ── */}
      <div style={S.card}>
        <h2 style={S.sectionTitle}>Personal Information</h2>
        <p style={S.sectionSub}>Update your name and contact details. Changes take effect immediately.</p>

        {saveSuccess && (
          <div style={S.successBanner}>
            <CheckCircle size={16} color="#065F46" />
            Profile updated successfully. Your name is now displayed throughout BizTrack.
          </div>
        )}
        {error && <div style={S.errorBanner}>{error}</div>}

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1.25rem' }}>
          {/* Full Name */}
          <FormField icon={<User size={16} />} label="Full Name">
            <input
              type="text"
              className="input"
              placeholder="e.g. Khairul Tajudin"
              value={form.full_name}
              onChange={e => setForm({ ...form, full_name: e.target.value })}
              style={S.input}
            />
          </FormField>

          {/* Email — read only */}
          <FormField icon={<Mail size={16} />} label="Email Address">
            <input
              type="email"
              className="input"
              value={user?.email || ''}
              readOnly
              style={{ ...S.input, background: '#F9FAFB', color: '#9CA3AF', cursor: 'not-allowed' }}
            />
            <p style={{ fontSize: '0.72rem', color: '#9CA3AF', margin: '0.25rem 0 0 0.1rem' }}>
              Email is managed by your authentication provider.
            </p>
          </FormField>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            {/* Phone */}
            <FormField icon={<Phone size={16} />} label="Phone Number">
              <input
                type="tel"
                className="input"
                placeholder="+60 12-345 6789"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                style={S.input}
              />
            </FormField>

            {/* Job Title */}
            <FormField icon={<Briefcase size={16} />} label="Job Title">
              <input
                type="text"
                className="input"
                placeholder="e.g. Administrator"
                value={form.job_title}
                onChange={e => setForm({ ...form, job_title: e.target.value })}
                style={S.input}
              />
            </FormField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            {/* Timezone */}
            <FormField icon={<Globe size={16} />} label="Time Zone">
              <select
                className="input"
                value={form.timezone}
                onChange={e => setForm({ ...form, timezone: e.target.value })}
                style={{ ...S.input, background: 'white' }}
              >
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
                ))}
              </select>
            </FormField>

            {/* Language */}
            <FormField icon={<Globe size={16} />} label="Language">
              <select
                className="input"
                value={form.language}
                onChange={e => setForm({ ...form, language: e.target.value })}
                style={{ ...S.input, background: 'white' }}
              >
                {LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </FormField>
          </div>

          <div style={{ paddingTop: '0.5rem', borderTop: '1px solid #F3F4F6' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              style={{ minWidth: 140, height: 40 }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Change Password ── */}
      <div style={S.card}>
        <h2 style={S.sectionTitle}>Change Password</h2>
        <p style={S.sectionSub}>Choose a strong password. Minimum 6 characters.</p>

        {pwSuccess && (
          <div style={S.successBanner}>
            <CheckCircle size={16} color="#065F46" />
            Password changed successfully.
          </div>
        )}
        {pwError && <div style={S.errorBanner}>{pwError}</div>}

        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1.25rem' }}>
          <FormField icon={<Lock size={16} />} label="New Password">
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={pwForm.newPassword}
              onChange={e => setPwForm({ ...pwForm, newPassword: e.target.value })}
              style={S.input}
              required
            />
          </FormField>
          <FormField icon={<Lock size={16} />} label="Confirm New Password">
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={pwForm.confirmPassword}
              onChange={e => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
              style={S.input}
              required
            />
          </FormField>
          <div style={{ paddingTop: '0.5rem', borderTop: '1px solid #F3F4F6' }}>
            <button
              type="submit"
              className="btn btn-outline"
              disabled={changingPassword}
              style={{ minWidth: 160, height: 40 }}
            >
              {changingPassword ? 'Updating...' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────
const FormField: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
  <div className="input-group" style={{ marginBottom: 0 }}>
    <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#374151' }}>
      <span style={{ color: '#9CA3AF' }}>{icon}</span>
      {label}
    </label>
    {children}
  </div>
);

// ─── Styles ───────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  card: {
    background: '#FFFFFF',
    borderRadius: '14px',
    border: '1px solid #E5E7EB',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    padding: '1.5rem',
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#111827',
    margin: 0,
  },
  sectionSub: {
    fontSize: '0.8rem',
    color: '#9CA3AF',
    margin: '0.2rem 0 0',
  },
  input: {
    width: '100%',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    position: 'relative',
  },
  avatarInitials: {
    fontSize: '1.5rem',
    fontWeight: 800,
    color: 'white',
    letterSpacing: '-0.02em',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: '#374151',
    border: '2px solid white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  successBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    background: '#D1FAE5',
    color: '#065F46',
    borderRadius: '8px',
    padding: '0.625rem 0.875rem',
    fontSize: '0.825rem',
    fontWeight: 500,
    marginTop: '1rem',
  },
  errorBanner: {
    background: '#FEF2F2',
    color: '#991B1B',
    borderRadius: '8px',
    padding: '0.625rem 0.875rem',
    fontSize: '0.825rem',
    marginTop: '1rem',
  },
};
