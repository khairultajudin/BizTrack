import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import {
  LogOut, User as UserIcon, Settings, HelpCircle, ChevronDown
} from 'lucide-react';

export const Topbar: React.FC = () => {
  const { displayName, initials, businessName, role } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <header className="topbar">
      {/* Left: contextual greeting */}
      <div>
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#6B7280' }}>
          {greeting()},{' '}
          <span style={{ fontWeight: 600, color: '#111827' }}>{displayName}</span>
        </p>
        {businessName && (
          <p style={{ margin: 0, fontSize: '0.72rem', color: '#9CA3AF', marginTop: '0.1rem' }}>
            {businessName}
          </p>
        )}
      </div>

      {/* Right: user menu */}
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setMenuOpen(o => !o)}
          style={S.avatarBtn}
          aria-label="User menu"
          aria-expanded={menuOpen}
        >
          {/* Avatar */}
          <div style={S.avatar}>{initials}</div>
          <div style={{ textAlign: 'left' }}>
            <p style={S.avatarName}>{displayName}</p>
            <p style={S.avatarRole}>{role}</p>
          </div>
          <ChevronDown
            size={14}
            color="#9CA3AF"
            style={{ transition: 'transform 0.2s', transform: menuOpen ? 'rotate(180deg)' : 'none' }}
          />
        </button>

        {/* Dropdown */}
        {menuOpen && (
          <div style={S.dropdown}>
            {/* Identity header */}
            <div style={S.dropdownHeader}>
              <div style={{ ...S.avatar, width: 36, height: 36, fontSize: '0.85rem' }}>{initials}</div>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem', color: '#111827' }}>{displayName}</p>
                <p style={{ margin: 0, fontSize: '0.72rem', color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {businessName}
                </p>
              </div>
            </div>

            <div style={S.dropdownDivider} />

            <DropdownItem
              icon={<UserIcon size={15} />}
              label="My Profile"
              onClick={() => { setMenuOpen(false); navigate('/profile'); }}
            />
            <DropdownItem
              icon={<Settings size={15} />}
              label="Business Settings"
              onClick={() => { setMenuOpen(false); navigate('/settings'); }}
            />
            <DropdownItem
              icon={<HelpCircle size={15} />}
              label="Help & Support"
              onClick={() => { setMenuOpen(false); window.open('mailto:support@biztrack.app'); }}
            />

            <div style={S.dropdownDivider} />

            <DropdownItem
              icon={<LogOut size={15} />}
              label="Sign Out"
              onClick={handleLogout}
              danger
            />
          </div>
        )}
      </div>
    </header>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────
const DropdownItem: React.FC<{
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}> = ({ icon, label, onClick, danger }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.625rem',
      width: '100%',
      padding: '0.5rem 0.75rem',
      background: 'none',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '0.835rem',
      fontWeight: 500,
      color: danger ? '#EF4444' : '#374151',
      textAlign: 'left',
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLElement).style.background = danger ? '#FEF2F2' : '#F9FAFB';
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLElement).style.background = 'none';
    }}
  >
    <span style={{ color: danger ? '#EF4444' : '#9CA3AF', display: 'flex' }}>{icon}</span>
    {label}
  </button>
);

// ─── Styles ───────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  avatarBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    padding: '0.375rem 0.625rem',
    background: 'none',
    border: '1px solid #E5E7EB',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontWeight: 700,
    fontSize: '0.75rem',
    flexShrink: 0,
  },
  avatarName: {
    margin: 0,
    fontSize: '0.825rem',
    fontWeight: 600,
    color: '#111827',
    lineHeight: 1.2,
  },
  avatarRole: {
    margin: 0,
    fontSize: '0.7rem',
    color: '#9CA3AF',
    textTransform: 'capitalize',
  },
  dropdown: {
    position: 'absolute',
    right: 0,
    top: 'calc(100% + 8px)',
    width: 220,
    background: '#FFFFFF',
    border: '1px solid #E5E7EB',
    borderRadius: '12px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)',
    padding: '0.5rem',
    zIndex: 1000,
  },
  dropdownHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    padding: '0.375rem 0.375rem 0.625rem',
  },
  dropdownDivider: {
    height: 1,
    background: '#F3F4F6',
    margin: '0.375rem 0',
  },
};
