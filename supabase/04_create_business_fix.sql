-- ==========================================
-- BIZTRACK ONBOARDING HOTFIX
-- ==========================================
-- This updates the create_business RPC to include self-healing logic 
-- for users who were created before the database schema existed.

CREATE OR REPLACE FUNCTION public.create_business(business_name text)
RETURNS uuid AS $$
DECLARE
  new_business_id uuid;
BEGIN
  -- Check if user is logged in
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Self-Healing Profile Check
  -- If the user signed up BEFORE the database trigger was created, their profile will be missing.
  -- This safely reconstructs it from their current authenticated session JWT payload.
  INSERT INTO public.profiles (id, email, full_name) 
  VALUES (
    auth.uid(), 
    COALESCE(auth.jwt()->>'email', 'unknown@example.com'), 
    auth.jwt()->'user_metadata'->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Insert business
  INSERT INTO public.businesses (name) 
  VALUES (business_name) 
  RETURNING id INTO new_business_id;
  
  -- 3. Assign user as Creator
  INSERT INTO public.business_users (business_id, user_id, role) 
  VALUES (new_business_id, auth.uid(), 'Creator');
  
  -- 4. Initialize settings
  INSERT INTO public.business_settings (business_id) VALUES (new_business_id);
  INSERT INTO public.creator_settings (business_id) VALUES (new_business_id);
  
  RETURN new_business_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
