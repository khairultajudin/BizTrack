-- ============================================================
-- BizTrack: Profile RLS + Full Name Backfill
-- Run this once in Supabase SQL Editor
-- ============================================================

-- 1. Backfill full_name for existing users who have it in auth metadata
--    but it was not copied to profiles (e.g. users created before trigger was patched)
UPDATE public.profiles p
SET full_name = COALESCE(
  -- Try auth metadata full_name first
  (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = p.id),
  -- Fall back to leaving it null (user will set via My Profile)
  p.full_name
)
WHERE p.full_name IS NULL OR p.full_name = '';

-- 2. Add missing profile columns if not already present
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone        TEXT,
  ADD COLUMN IF NOT EXISTS job_title    TEXT,
  ADD COLUMN IF NOT EXISTS timezone     TEXT DEFAULT 'Asia/Kuala_Lumpur',
  ADD COLUMN IF NOT EXISTS language     TEXT DEFAULT 'en-MY',
  ADD COLUMN IF NOT EXISTS avatar_url   TEXT,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 3. Ensure profiles RLS allows users to read and update their OWN row
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- 4. Patch handle_new_user to also copy phone/name from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(
      EXCLUDED.full_name,
      public.profiles.full_name
    );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
