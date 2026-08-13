-- ==========================================
-- BIZTRACK MASTER SCHEMA MIGRATION (IDEMPOTENT)
-- ==========================================
-- Run this in the Supabase SQL Editor.
-- It safely creates all missing tables, RPCs, policies, and triggers without dropping existing data.

-- Enable pgcrypto for UUIDs
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==========================================
-- 1. CORE TABLES
-- ==========================================
CREATE TABLE IF NOT EXISTS public.businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.business_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('Creator', 'Admin', 'Staff', 'ReadOnly')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(business_id, user_id)
);

-- ==========================================
-- 2. SETTINGS TABLES
-- ==========================================
CREATE TABLE IF NOT EXISTS public.business_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE UNIQUE,
    default_currency TEXT DEFAULT 'USD',
    brand_color TEXT DEFAULT '#3B82F6',
    business_logo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.creator_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE UNIQUE,
    business_template TEXT DEFAULT 'tuition',
    enabled_modules JSONB DEFAULT '{"students": true, "classes": true, "teachers": true, "payments": true, "expenses": true, "reports": true, "inventory": false, "attendance": false, "booking": false, "crm": false, "payroll": false, "pos": false}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    layout_name TEXT NOT NULL DEFAULT 'Default',
    config JSONB NOT NULL,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 3. BUSINESS ENTITIES (WITH SOFT DELETES)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT,
    phone TEXT,
    salary_type TEXT,
    salary_amount NUMERIC(10, 2),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    teacher_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
    monthly_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
    max_students INT,
    status TEXT DEFAULT 'Active',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    assigned_group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
    monthly_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'Active',
    start_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- ==========================================
-- 4. FINANCIAL & TRANSACTIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    year INT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method TEXT NOT NULL,
    reference_number TEXT,
    notes TEXT,
    status TEXT DEFAULT 'Paid' CHECK (status IN ('Paid', 'Pending', 'Cancelled')),
    import_source TEXT DEFAULT 'Manual',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    receipt_url TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.staff_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    year INT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- ==========================================
-- 5. IMPORTS, NOTIFICATIONS & AUDIT LOGS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.import_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    import_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    provider TEXT NOT NULL,
    file_name TEXT NOT NULL,
    rows_imported INT DEFAULT 0,
    rows_failed INT DEFAULT 0,
    duration_ms INT DEFAULT 0,
    status TEXT DEFAULT 'Completed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.import_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    mapping_name TEXT NOT NULL,
    column_map JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info' CHECK (type IN ('success', 'warning', 'error', 'info', 'system')),
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 6. RPC FUNCTIONS & TRIGGERS
-- ==========================================

-- Auto-create profile when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind Trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Secure RPC to onboard a new business
CREATE OR REPLACE FUNCTION public.create_business(business_name text)
RETURNS uuid AS $$
DECLARE
  new_business_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.businesses (name) 
  VALUES (business_name) 
  RETURNING id INTO new_business_id;
  
  INSERT INTO public.business_users (business_id, user_id, role) 
  VALUES (new_business_id, auth.uid(), 'Creator');
  
  INSERT INTO public.business_settings (business_id) VALUES (new_business_id);
  INSERT INTO public.creator_settings (business_id) VALUES (new_business_id);
  
  RETURN new_business_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper Function for RLS
CREATE OR REPLACE FUNCTION public.user_businesses()
RETURNS SETOF UUID AS $$
  SELECT business_id FROM public.business_users WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;


-- ==========================================
-- 7. ENABLE RLS & CREATE POLICIES (Idempotent)
-- ==========================================
DO $$ 
DECLARE
  table_record record;
BEGIN
  FOR table_record IN 
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' 
    AND tablename IN (
      'businesses', 'profiles', 'business_users', 'business_settings', 'creator_settings', 
      'staff', 'groups', 'customers', 'payments', 'expenses', 'staff_payments', 
      'activity_logs', 'dashboard_layouts', 'import_history', 'import_mappings', 'notifications'
    )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', table_record.tablename);
    
    -- Drop existing policy if it exists to allow idempotent re-creation
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS "Users can access data in their business" ON public.%I;', table_record.tablename);
    EXCEPTION WHEN OTHERS THEN END;

    -- Create unified policy for all tables that have a business_id
    IF table_record.tablename NOT IN ('businesses', 'profiles', 'business_users') THEN
      EXECUTE format(
        'CREATE POLICY "Users can access data in their business" ON public.%I ' ||
        'FOR ALL USING (business_id IN (SELECT public.user_businesses()));', 
        table_record.tablename
      );
    END IF;
  END LOOP;
END $$;

-- Specific policies for root mapping tables
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view their businesses" ON public.businesses;
  CREATE POLICY "Users can view their businesses" ON public.businesses
    FOR SELECT USING (id IN (SELECT public.user_businesses()));
EXCEPTION WHEN OTHERS THEN END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view users in their business" ON public.business_users;
  CREATE POLICY "Users can view users in their business" ON public.business_users
    FOR SELECT USING (business_id IN (SELECT public.user_businesses()));
EXCEPTION WHEN OTHERS THEN END $$;
