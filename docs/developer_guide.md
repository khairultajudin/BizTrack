# BizTrack Developer Guide

## Local Development
1. Clone the repository.
2. Run `npm install`.
3. Rename `.env.example` to `.env` and fill in your Supabase credentials:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Run `npm run dev`.

## Adding a New Module
1. Create the database table in Supabase and ensure it includes `business_id`.
2. Apply RLS policies to the new table.
3. Add the module key to `DEFAULT_MODULES` in `src/context/TemplateContext.tsx`.
4. Create the UI component in `src/pages/`.
5. Wrap the route in `src/App.tsx` with `<ModuleRoute moduleName="yourModule">`.
6. Add the navigation link in `src/components/layout/Sidebar.tsx` wrapped in a conditional check for the module.

## UI Components
- Use `var(--primary)` for primary branding colors instead of hardcoded tailwind classes, to respect the Creator's brand color settings.
- Reusable components like `Modal` and `ReportFilters` are located in `src/components/ui/`.
