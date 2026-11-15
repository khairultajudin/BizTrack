-- ============================================================
-- BIZTRACK MIGRATION 09 ROLLBACK: MULTI-BRANCH TEACHER ASSIGNMENT
-- ============================================================
-- Restores Migration 08 directory/staff RLS and RPC signatures
-- without weakening salary privacy or modifying staff/payment data.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.set_teacher_branch_assignments(UUID, UUID, UUID[]);

-- Restore Migration 08 save_teacher_with_salary (9-arg)
DROP FUNCTION IF EXISTS public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, UUID[]);
DROP FUNCTION IF EXISTS public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID);

CREATE OR REPLACE FUNCTION public.save_teacher_with_salary(
  p_business_id UUID,
  p_name TEXT,
  p_role TEXT,
  p_phone TEXT,
  p_salary_type TEXT,
  p_salary_amount NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_teacher_id UUID DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_name_trimmed TEXT;
  v_salary_type TEXT;
  v_salary_amount NUMERIC;
  v_has_branches BOOLEAN;
BEGIN
  IF p_business_id IS NULL OR NOT public.is_salary_authorized(p_business_id) THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to modify teacher salary information.';
  END IF;

  v_name_trimmed := TRIM(p_name);
  IF v_name_trimmed IS NULL OR v_name_trimmed = '' THEN
    RAISE EXCEPTION 'Teacher name is required.';
  END IF;

  v_salary_type := COALESCE(NULLIF(TRIM(p_salary_type), ''), 'Monthly');
  IF v_salary_type NOT IN ('Monthly', 'Hourly', 'Commission', 'Percentage') THEN
    RAISE EXCEPTION 'Invalid salary_type: %.', v_salary_type;
  END IF;

  v_salary_amount := COALESCE(p_salary_amount, 0);
  IF v_salary_amount < 0 THEN
    RAISE EXCEPTION 'Salary amount cannot be negative.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.business_id = p_business_id
  ) INTO v_has_branches;

  IF p_branch_id IS NOT NULL THEN
    IF NOT v_has_branches THEN
      RAISE EXCEPTION 'Invalid branch_id for single-tenant business %.', p_business_id;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = p_branch_id AND b.business_id = p_business_id AND b.is_active = true
    ) THEN
      RAISE EXCEPTION 'Invalid or inactive branch_id % for business %.', p_branch_id, p_business_id;
    END IF;
  END IF;

  IF p_teacher_id IS NOT NULL THEN
    UPDATE public.staff
    SET
      name = v_name_trimmed,
      role = COALESCE(NULLIF(TRIM(p_role), ''), 'Teacher'),
      phone = NULLIF(TRIM(p_phone), ''),
      salary_type = v_salary_type,
      salary_amount = v_salary_amount,
      notes = p_notes,
      branch_id = COALESCE(p_branch_id, branch_id)
    WHERE id = p_teacher_id
      AND business_id = p_business_id
      AND deleted_at IS NULL
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Active teacher with ID % not found in business %.', p_teacher_id, p_business_id;
    END IF;
  ELSE
    INSERT INTO public.staff (
      business_id,
      branch_id,
      name,
      role,
      phone,
      salary_type,
      salary_amount,
      notes
    ) VALUES (
      p_business_id,
      p_branch_id,
      v_name_trimmed,
      COALESCE(NULLIF(TRIM(p_role), ''), 'Teacher'),
      NULLIF(TRIM(p_phone), ''),
      v_salary_type,
      v_salary_amount,
      p_notes
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID) TO authenticated;

-- Restore Migration 08 get_teachers_with_salary
DROP FUNCTION IF EXISTS public.get_teachers_with_salary(UUID);

CREATE OR REPLACE FUNCTION public.get_teachers_with_salary(p_business_id UUID)
RETURNS TABLE (
  id UUID,
  business_id UUID,
  branch_id UUID,
  name TEXT,
  role TEXT,
  phone TEXT,
  salary_type TEXT,
  salary_amount NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF p_business_id IS NULL OR NOT public.is_salary_authorized(p_business_id) THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to view teacher salary information.';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.business_id,
    s.branch_id,
    s.name,
    s.role,
    s.phone,
    s.salary_type,
    s.salary_amount,
    s.notes,
    s.created_at
  FROM public.staff s
  WHERE s.business_id = p_business_id
    AND s.deleted_at IS NULL
  ORDER BY s.created_at DESC;
END;
$$;

ALTER FUNCTION public.get_teachers_with_salary(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_teachers_with_salary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teachers_with_salary(UUID) TO authenticated;

-- Restore Migration 08 get_staff_directory
DROP FUNCTION IF EXISTS public.get_staff_directory(UUID);

CREATE OR REPLACE FUNCTION public.get_staff_directory(p_business_id UUID)
RETURNS TABLE (
  id UUID,
  business_id UUID,
  branch_id UUID,
  name TEXT,
  role TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_user_branch_id UUID;
  v_has_branches BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'Business ID is required.';
  END IF;

  SELECT bu.role, bu.branch_id
  INTO v_role, v_user_branch_id
  FROM public.business_users bu
  WHERE bu.business_id = p_business_id
    AND bu.user_id = v_user_id
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('Creator', 'Admin', 'Staff', 'ReadOnly') THEN
    RAISE EXCEPTION 'Access denied to business %.', p_business_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.business_id = p_business_id
  ) INTO v_has_branches;

  IF v_has_branches AND v_role IN ('Staff', 'ReadOnly') AND v_user_branch_id IS NULL AND v_role = 'Staff' THEN
    RAISE EXCEPTION 'Access denied: Staff user is not assigned to a branch.';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.business_id,
    s.branch_id,
    s.name,
    s.role,
    s.created_at
  FROM public.staff s
  WHERE s.business_id = p_business_id
    AND s.deleted_at IS NULL
    AND (
      NOT v_has_branches
      OR v_role IN ('Creator', 'Admin')
      OR (v_role = 'ReadOnly' AND v_user_branch_id IS NULL)
      OR s.branch_id = v_user_branch_id
      OR s.branch_id IS NULL
    )
  ORDER BY s.created_at DESC;
END;
$$;

ALTER FUNCTION public.get_staff_directory(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_staff_directory(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_directory(UUID) TO authenticated;

-- Restore Migration 08 public.staff SELECT policy
DROP POLICY IF EXISTS "Business members can view staff directory" ON public.staff;

CREATE POLICY "Business members can view staff directory"
  ON public.staff
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      public.has_branch_access(business_id, branch_id, false)
      OR (
        branch_id IS NULL
        AND business_id IN (SELECT public.user_businesses())
      )
    )
  );

DROP TRIGGER IF EXISTS trg_enforce_staff_branch_assignment ON public.staff_branch_assignments;
DROP FUNCTION IF EXISTS public.enforce_staff_branch_assignment();
DROP FUNCTION IF EXISTS public.is_unscoped_business_viewer(UUID);
DROP FUNCTION IF EXISTS public.is_multi_branch_business(UUID);
DROP TABLE IF EXISTS public.staff_branch_assignments;

ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_id_business_id_key;

COMMIT;
