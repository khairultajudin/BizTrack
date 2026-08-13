# BizTrack — Installation & Local Development Guide

This guide outlines the system requirements and step-by-step instructions to install and run **BizTrack** locally.

---

## 📋 System Requirements

- **Node.js**: `v18.0.0` or higher (Recommended: LTS v20.x)
- **Package Manager**: `npm` (v9+) or `yarn` / `pnpm`
- **Database Backend**: Supabase Project (Cloud or Self-Hosted Docker)
- **Supported Browsers**: Chrome, Edge, Safari, Firefox

---

## 🛠️ Step-by-Step Installation

### 1. Clone & Install Dependencies

```bash
git clone <repository-url>
cd BizTrack
npm install
```

### 2. Environment Variables Setup

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-publishable-key
```

> ⚠️ **Important**: Ensure no trailing slashes in `VITE_SUPABASE_URL`. Both environment variables are strictly required.

---

## 🗄️ Database Setup (Supabase)

1. Log into your [Supabase Dashboard](https://supabase.com).
2. Create a new Supabase project (or select your existing project).
3. Navigate to **SQL Editor**.
4. Run the SQL migrations in exact sequence:

```text
Migration Order:
1. supabase/03_master_schema_fix.sql
2. supabase/04_create_business_fix.sql
3. supabase/05_profile_rls_and_backfill.sql
```

### Verification Checklist in Supabase:
- [x] Extension `pgcrypto` enabled.
- [x] Tables created in `public` schema: `businesses`, `profiles`, `business_users`, `business_settings`, `creator_settings`, `staff`, `groups`, `customers`, `payments`, `expenses`, `staff_payments`, `activity_logs`, `dashboard_layouts`, `notifications`.
- [x] RPC function `create_business(business_name text)` created.
- [x] Trigger `on_auth_user_created` attached to `auth.users`.
- [x] Row Level Security (RLS) enabled across all tables.

---

## 🚀 Running Locally

Start the local development server with hot reloading:

```bash
npm run dev
```

The application will be available at: `http://localhost:5173`

---

## 🧪 Verification Commands

Before committing code or deploying, run the build verification:

```bash
# Type check and build bundle
npm run build

# Preview production build locally
npm run preview
```
