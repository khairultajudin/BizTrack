import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTemplate } from '../../context/TemplateContext';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard,
  Users,
  BookOpen,
  GraduationCap,
  CreditCard,
  Receipt,
  FileBarChart,
  Settings,
  PieChart,
  Database,
  HelpCircle,
  Building2,
} from 'lucide-react';

// ─── BizTrack SVG Logo ────────────────────────────────────────────────────────
// Clean graduation-cap-and-bar-chart education/business icon
const BizTrackIcon: React.FC<{ size?: number }> = ({ size = 32 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Background */}
    <rect width="32" height="32" rx="9" fill="#3B82F6" />

    {/* Graduation cap — flat top */}
    <polygon points="16,8 26,12.5 16,17 6,12.5" fill="white" opacity="0.95" />
    {/* Cap brim highlight */}
    <polygon points="16,8 26,12.5 16,14.5 6,12.5" fill="white" opacity="0.3" />

    {/* Left pillar of bar chart (below cap) */}
    <rect x="8" y="19" width="3.5" height="6" rx="1.2" fill="white" opacity="0.85" />
    {/* Middle bar — taller */}
    <rect x="14.25" y="16.5" width="3.5" height="8.5" rx="1.2" fill="white" />
    {/* Right bar */}
    <rect x="20.5" y="21" width="3.5" height="4" rx="1.2" fill="white" opacity="0.85" />
  </svg>
);

// ─── Nav item ─────────────────────────────────────────────────────────────────
interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon, label, end }) => (
  <NavLink
    to={to}
    end={end}
    style={{ textDecoration: 'none' }}
  >
    {({ isActive }) => (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: '0.5rem 0.75rem',
          borderRadius: '8px',
          fontWeight: isActive ? 600 : 400,
          fontSize: '0.875rem',
          color: isActive ? '#1D4ED8' : '#4B5563',
          background: isActive ? '#EFF6FF' : 'transparent',
          transition: 'background 0.15s, color 0.15s',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onMouseEnter={e => {
          if (!isActive) {
            (e.currentTarget as HTMLElement).style.background = '#F9FAFB';
            (e.currentTarget as HTMLElement).style.color = '#111827';
          }
        }}
        onMouseLeave={e => {
          if (!isActive) {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = '#4B5563';
          }
        }}
      >
        <span style={{
          display: 'flex',
          alignItems: 'center',
          color: isActive ? '#2563EB' : '#9CA3AF',
          flexShrink: 0,
          transition: 'color 0.15s',
        }}>
          {icon}
        </span>
        {label}
      </div>
    )}
  </NavLink>
);

// ─── Section divider label ────────────────────────────────────────────────────
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{
    fontSize: '0.675rem',
    fontWeight: 600,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    padding: '0 0.75rem',
    margin: '0 0 0.25rem 0',
  }}>
    {children}
  </p>
);

// ─── Component ────────────────────────────────────────────────────────────────
export const Sidebar: React.FC = () => {
  const { t, modules } = useTemplate();
  const { role, businessName, displayName, initials } = useAuth();

  const isAdmin = role === 'Creator' || role === 'Admin';

  return (
    <aside style={{
      width: '256px',
      minWidth: '256px',
      height: '100vh',
      background: '#FFFFFF',
      borderRight: '1px solid #E5E7EB',
      display: 'flex',
      flexDirection: 'column',
      position: 'sticky',
      top: 0,
      overflowY: 'auto',
    }}>

      {/* ── Brand header ── */}
      <div style={{
        padding: '1.375rem 1.125rem 1.125rem',
        borderBottom: '1px solid #F3F4F6',
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
      }}>
        <BizTrackIcon size={34} />
        <div>
          <p style={{
            margin: 0,
            fontWeight: 800,
            fontSize: '1.05rem',
            color: '#111827',
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
          }}>
            BizTrack
          </p>
          <p style={{
            margin: 0,
            fontSize: '0.68rem',
            color: '#9CA3AF',
            fontWeight: 500,
            marginTop: '0.1rem',
          }}>
            Business Management
          </p>
        </div>
      </div>

      {/* ── Main navigation ── */}
      <nav style={{
        flex: 1,
        padding: '1rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.125rem',
      }}>

        {/* Core */}
        <div style={{ marginBottom: '0.5rem' }}>
          <NavItem to="/" icon={<LayoutDashboard size={20} />} label={t('dashboard')} end />
        </div>

        {/* People & Programmes */}
        {(modules.students || modules.classes || modules.teachers) && (
          <div style={{ marginBottom: '1rem' }}>
            <SectionLabel>Manage</SectionLabel>
            {modules.students && (
              <NavItem to="/students" icon={<Users size={20} />} label={t('students')} />
            )}
            {modules.classes && (
              <NavItem to="/classes" icon={<BookOpen size={20} />} label={t('classes')} />
            )}
            {modules.teachers && (
              <NavItem to="/teachers" icon={<GraduationCap size={20} />} label={t('teachers')} />
            )}
          </div>
        )}

        {/* Finance */}
        {(modules.payments || modules.expenses || modules.reports) && (
          <div style={{ marginBottom: '1rem' }}>
            <SectionLabel>Finance</SectionLabel>
            {modules.payments && (
              <NavItem to="/payments" icon={<CreditCard size={20} />} label={t('payments')} />
            )}
            {modules.expenses && (
              <NavItem to="/expenses" icon={<Receipt size={20} />} label={t('expenses')} />
            )}
            {modules.reports && (
              <NavItem to="/reports" icon={<FileBarChart size={20} />} label={t('reports')} />
            )}
          </div>
        )}

        {/* Administration */}
        {isAdmin && (
          <div style={{ marginBottom: '1rem' }}>
            <SectionLabel>Administration</SectionLabel>
            <NavItem to="/settings" icon={<Settings size={20} />} label={t('settings')} />
            <NavItem to="/analytics" icon={<PieChart size={20} />} label="Analytics" />
            <NavItem to="/data-imports" icon={<Database size={20} />} label="Data Imports" />
          </div>
        )}
      </nav>

      {/* ── Bottom section ── */}
      <div style={{
        borderTop: '1px solid #F3F4F6',
        padding: '0.875rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.375rem',
      }}>

        {/* User identity chip */}
        <NavLink to="/profile" style={{ textDecoration: 'none' }}>
          {({ isActive }) => (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              padding: '0.5rem 0.75rem',
              borderRadius: '8px',
              background: isActive ? '#EFF6FF' : 'transparent',
              transition: 'background 0.15s',
              cursor: 'pointer',
            }}
            onMouseEnter={e => {
              if (!isActive) (e.currentTarget as HTMLElement).style.background = '#F9FAFB';
            }}
            onMouseLeave={e => {
              if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
            >
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 700, fontSize: '0.7rem', flexShrink: 0,
              }}>
                {initials}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName}
                </p>
                <p style={{ margin: 0, fontSize: '0.68rem', color: '#9CA3AF', marginTop: '0.05rem' }}>
                  My Profile
                </p>
              </div>
            </div>
          )}
        </NavLink>

        {/* Business card */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: '0.5rem 0.75rem',
          borderRadius: '8px',
          background: '#F9FAFB',
          border: '1px solid #F3F4F6',
        }}>
          <div style={{
            width: 30,
            height: 30,
            borderRadius: '7px',
            background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Building2 size={15} color="white" />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{
              margin: 0,
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#111827',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {businessName || 'My Business'}
            </p>
            <p style={{
              margin: 0,
              fontSize: '0.68rem',
              color: '#9CA3AF',
              marginTop: '0.05rem',
            }}>
              {role || 'Member'}
            </p>
          </div>
        </div>

        {/* Help & Support */}
        <a
          href="mailto:support@biztrack.app"
          style={{ textDecoration: 'none' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              padding: '0.45rem 0.75rem',
              borderRadius: '8px',
              fontSize: '0.825rem',
              color: '#6B7280',
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = '#F9FAFB';
              (e.currentTarget as HTMLElement).style.color = '#111827';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
              (e.currentTarget as HTMLElement).style.color = '#6B7280';
            }}
          >
            <HelpCircle size={17} color="#9CA3AF" />
            Help &amp; Support
          </div>
        </a>
      </div>

    </aside>
  );
};
