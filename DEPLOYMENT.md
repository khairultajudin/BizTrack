# BizTrack — Production Deployment & Maintenance Guide

This document contains step-by-step instructions for deploying BizTrack to production cloud platforms, managing environment configuration, and performing database backups and restores.

---

## 🌐 Production Deployment Options

BizTrack is built as a static Single Page Application (SPA) with Vite and React. It can be hosted on any modern static hosting provider.

### Option A: Vercel Deployment (Recommended)

1. Push your repository to GitHub / GitLab / Bitbucket.
2. Log into [Vercel Dashboard](https://vercel.com) and click **Add New Project**.
3. Import your BizTrack repository.
4. Framework Preset: **Vite**.
5. Set Environment Variables:
   - `VITE_SUPABASE_URL`: Your Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase Anon Public Key
6. Click **Deploy**.

#### Rewrites Configuration (`vercel.json`)
Ensure SPA routing works properly for nested routes (e.g. `/profile`, `/students`):

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

---

### Option B: Netlify Deployment

1. Connect repository in [Netlify](https://netlify.com).
2. Build Command: `npm run build`
3. Publish Directory: `dist`
4. Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Create `public/_redirects` file:
   ```text
   /*    /index.html   200
   ```

---

## 🔒 Supabase Authentication & Security Configuration

In your production Supabase dashboard:

1. **Authentication Settings**:
   - Navigate to **Auth** -> **URL Configuration**.
   - Site URL: `https://your-domain.com`
   - Redirect URLs: `https://your-domain.com/*`
2. **Email Provider**:
   - Ensure Email Provider is enabled under **Auth** -> **Providers**.
   - (Optional) Configure custom SMTP credentials for branded emails.
3. **Database RLS Policies**:
   - Verify that Row Level Security is active on all tables in `public` schema.

---

## 💾 Database Backup Procedure

### Automated Backups (Supabase Pro/Enterprise)
Supabase automatically handles daily backups with point-in-time recovery (PITR) on paid tiers.

### Manual Database Backup via Supabase CLI / `pg_dump`

To perform an on-demand manual backup of your PostgreSQL database schema and data:

```bash
# Export schema and data using pg_dump
pg_dump "postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres" \
  --clean \
  --if-exists \
  --quote-all-identifiers \
  --file=biztrack_backup_$(date +%Y%m%d_%H%M%S).sql
```

---

## 🔄 Database Restore Procedure

To restore a backup into a new or target Supabase database instance:

```bash
# Restore database snapshot
psql "postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres" \
  -f biztrack_backup_20260728_120000.sql
```

After restoring:
1. Re-apply schema fix triggers if required (`on_auth_user_created`).
2. Test user authentication and multi-tenant access.
