-- ==========================================
-- ONBOARDING & TRIGGERS (Run in SQL Editor)
-- ==========================================

-- 1. Auto-create profile when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists to prevent errors on re-run
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 2. Secure RPC to onboard a new business
-- This runs with SECURITY DEFINER to bypass RLS during creation
CREATE OR REPLACE FUNCTION public.create_business(business_name text)
RETURNS uuid AS $$
DECLARE
  new_business_id uuid;
BEGIN
  -- Check if user is logged in
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Insert business
  INSERT INTO public.businesses (name) 
  VALUES (business_name) 
  RETURNING id INTO new_business_id;
  
  -- Assign user as Creator
  INSERT INTO public.business_users (business_id, user_id, role) 
  VALUES (new_business_id, auth.uid(), 'Creator');
  
  -- Initialize settings
  INSERT INTO public.business_settings (business_id) VALUES (new_business_id);
  INSERT INTO public.creator_settings (business_id) VALUES (new_business_id);
  
  RETURN new_business_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
