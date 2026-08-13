# BizTrack Architecture

BizTrack is designed as a modern, multi-tenant SaaS application catering to small service-based businesses (tuition centres, gyms, workshops).

## Technology Stack
- **Frontend**: React 18, TypeScript, Vite
- **Routing**: React Router v6
- **Styling**: Vanilla CSS with CSS Variables for theming (minimal external dependencies)
- **State Management**: React Context API (`AuthContext`, `TemplateContext`)
- **Backend / Database**: Supabase (PostgreSQL)
- **Charts**: Recharts
- **Icons**: Lucide React

## Multi-Tenant Strategy
BizTrack uses **Row Level Security (RLS)** in PostgreSQL to enforce multi-tenancy.
- Every business entity (e.g. `students`, `payments`, `expenses`) has a `business_id` column.
- Users are mapped to a `business_id` via the `business_users` table.
- A central Postgres function `user_businesses()` is used in RLS policies to dynamically filter rows based on the active user's session `auth.uid()`.

## Module Engine
The `TemplateContext` manages two critical configurations:
1. **Business Template**: Swaps UI terminology (e.g., "Students" vs "Members" vs "Clients").
2. **Enabled Modules**: A JSON object toggling core features (`students`, `classes`, `teachers`, `payments`, `expenses`).
If a module is disabled, the `ModuleRoute` wrapper physically blocks URL access, and the UI dynamically hides all references to it.
