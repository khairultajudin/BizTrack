# BizTrack — Release Changelog

All notable changes to the BizTrack SaaS platform will be documented in this file.

---

## [1.0.0-pilot] - 2026-07-28

### 🚀 Pilot Release Highlights
- Initial Pilot Release for Tuition Centre & Academy Administrators (Akademik Mega).
- Complete multi-tenant SaaS architecture powered by React 18, Vite, and Supabase.
- Full localization for the Malaysian market (`en-MY` locale, MYR currency formatting, `Asia/Kuala_Lumpur` timezone).

### 🎯 Features & Modules
- **Authentication & Multi-Tenancy**:
  - Supabase Auth integration with custom metadata (`full_name`).
  - Row Level Security (RLS) policies enforcing complete tenant data isolation.
  - Automated business onboarding via PostgreSQL RPC `create_business()`.

- **User Identity & My Profile**:
  - Centralized identity resolution chain (`profiles.full_name` → `auth.user_metadata` → `email`).
  - Dedicated `/profile` management page: Full Name, Phone, Job Title, Time Zone, Language, Password Change.
  - Instant live UI synchronization via `AuthContext.refreshProfile()` without page reloads or logouts.
  - Dynamic initials avatar system (`#3B82F6` gradient badge).

- **Dashboard SaaS Hub**:
  - Dynamic greeting with live business name indicator.
  - 5 KPI summary cards: Active Students, Teachers, Active Classes, Monthly Revenue, Outstanding Collections.
  - 6-Month Income vs Expenses interactive Area Chart (Recharts) with MYR tooltips.
  - Live activity feeds for Recent Payments & Recent Expenses.
  - Today's Focus alert panel with collection rates and pending fee indicators.
  - One-click Quick Actions bar.

- **People & Class Management**:
  - **Students Directory**: Directory listing, contact details, assigned class, monthly fee, active status, search & filter toolbar, soft deletion.
  - **Teachers Directory**: Staff records, roles, contact numbers, compensation models (Monthly/Hourly/Commission), search toolbar.
  - **Classes / Groups**: Class scheduling, fee structure, capacity limits, teacher assignments, search & status filter toolbar.

- **Finance & Analytics**:
  - **Payments Ledger**: Collection records, billing period tracking, payment methods (Cash, Transfer, Card, Online), payment status pills, soft deletion.
  - **Expenses Ledger**: Operational expense tracking, category categorization (Rental, Utilities, Marketing, etc.), soft deletion.
  - **Financial Reports**: Income vs Expenses bar charts, summary stats, print-optimized A4 layout.
  - **Advanced Analytics**: Growth lines, net profit trends, and payment method distribution charts.

- **Administration & System Health**:
  - **Creator Settings**: Template switching (Tuition vs Gym vs Workshop), module toggling, currency configuration, brand color customization.
  - **System Health Diagnostics**: Real-time database latency check, tenant context status, and database schema audit.

### 🔐 Security & Database
- Applied PostgreSQL schema migrations (`03_master_schema_fix.sql`, `04_create_business_fix.sql`, `05_profile_rls_and_backfill.sql`).
- Enforced soft-delete triggers and audit tracking (`deleted_at`, `deleted_by`).
- Profiles self-read and self-update RLS policies implemented.
