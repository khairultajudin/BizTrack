-- ============================================================
-- BIZTRACK MIGRATION 09: MULTI-BRANCH TEACHER ASSIGNMENT
-- ============================================================
-- Target Business: PUSAT TUISYEN AKADEMIK MEGA (UUID: 978d2b0c-6a2b-4c28-9000-71dc23f96781)
-- Authorized Assignment & Salary Administrator: Puan Hana / NORHANA ABDUL RANI
--   Auth UID: d2b660bf-10d3-4d94-94ec-0b8f6e0908e6
-- Protected Workspace (DO NOT TOUCH): Akademik Mega (UUID: ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad)
--
-- Scope:
--   1. Normalized many-to-many table public.staff_branch_assignments
--      with composite FKs enforcing business ownership consistency and
--      unique constraint preventing duplicate (staff_id, branch_id) rows.
--   2. Safe transition from public.staff.branch_id:
--      - Preserves public.staff.branch_id and Migration 08 historical provenance.
--      - Copies existing non-null staff.branch_id rows into staff_branch_assignments.
--      - Leaves NULL staff.branch_id rows unassigned (0 rows in assignments).
--   3. Strict database-level authorization:
--      - Only exact Puan Hana UID (via public.is_salary_authorized) can
--        insert, update, or delete teacher branch assignments.
--      - Generic Admin, Creator, Staff, and ReadOnly cannot manage assignments.
--      - Branch Staff only see teachers assigned to their own branch in
--        staff_branch_assignments (unassigned teachers are NOT exposed to Staff).
--      - Preserves all Migration 08 salary privacy and payroll reconciliation rules.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. PRE-MIGRATION SAFETY CHECKS
-- ------------------------------------------------------------
DO $$
DECLARE
  v_target_biz_id CONSTANT UUID := '978d2b0c-6a2b-4c28-9000-71dc23f96781';
  v_authorized_uid CONSTANT UUID := 'd2b660bf-10d3-4d94-94ec-0b8f6e0908e6';
  v_protected_biz_id CONSTANT UUID := 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = v_target_biz_id) THEN
    RAISE EXCEPTION 'Migration 09 aborted: Target business % does not exist.', v_target_biz_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_users
    WHERE business_id = v_target_biz_id AND user_id = v_authorized_uid
  ) THEN
    RAISE EXCEPTION 'Migration 09 aborted: Authorized UID % is not linked to target business %.',
      v_authorized_uid, v_target_biz_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_salary_authorized'
  ) THEN
    RAISE EXCEPTION 'Migration 09 aborted: Migration 08 prerequisite public.is_salary_authorized() is missing.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.branches WHERE business_id = v_protected_biz_id
  ) THEN
    RAISE EXCEPTION 'Migration 09 aborted: Protected workspace % has unexpected branches.', v_protected_biz_id;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. COMPOSITE KEY ON public.staff (id, business_id) FOR CROSS-BUSINESS FK SAFETY
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.staff'::regclass
      AND contype IN ('p', 'u')
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'id' AND NOT attisdropped),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'business_id' AND NOT attisdropped)
      ]
  ) THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_id_business_id_key UNIQUE (id, business_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. NORMALIZED MANY-TO-MANY TABLE: public.staff_branch_assignments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_branch_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT staff_branch_assignments_staff_branch_key UNIQUE (staff_id, branch_id),
  CONSTRAINT staff_branch_assignments_staff_biz_fkey
    FOREIGN KEY (staff_id, business_id)
    REFERENCES public.staff(id, business_id)
    ON DELETE CASCADE,
  CONSTRAINT staff_branch_assignments_branch_biz_fkey
    FOREIGN KEY (branch_id, business_id)
    REFERENCES public.branches(id, business_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sba_business_branch_staff
  ON public.staff_branch_assignments (business_id, branch_id, staff_id);

CREATE INDEX IF NOT EXISTS idx_sba_business_staff
  ON public.staff_branch_assignments (business_id, staff_id);

-- ------------------------------------------------------------
-- 4. INTEGRITY TRIGGER ON public.staff_branch_assignments
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_staff_branch_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_deleted_at TIMESTAMPTZ;
  v_branch_active BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'Security violation: business_id is immutable for staff_branch_assignments.';
  END IF;

  SELECT s.deleted_at
  INTO v_staff_deleted_at
  FROM public.staff s
  WHERE s.id = NEW.staff_id
    AND s.business_id = NEW.business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cross-business or missing staff violation: Teacher % does not belong to business %.',
      NEW.staff_id, NEW.business_id;
  END IF;

  IF v_staff_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot assign branches to soft-deleted teacher %.', NEW.staff_id;
  END IF;

  SELECT b.is_active
  INTO v_branch_active
  FROM public.branches b
  WHERE b.id = NEW.branch_id
    AND b.business_id = NEW.business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cross-business or missing branch violation: Branch % does not belong to business %.',
      NEW.branch_id, NEW.business_id;
  END IF;

  IF NOT COALESCE(v_branch_active, FALSE) THEN
    RAISE EXCEPTION 'Inactive branch violation: Cannot assign teacher to inactive branch %.', NEW.branch_id;
  END IF;

  IF NEW.created_by IS NULL AND auth.uid() IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()) THEN
      NEW.created_by := auth.uid();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_staff_branch_assignment() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_staff_branch_assignment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_staff_branch_assignment() TO authenticated;

DROP TRIGGER IF EXISTS trg_enforce_staff_branch_assignment ON public.staff_branch_assignments;
CREATE TRIGGER trg_enforce_staff_branch_assignment
  BEFORE INSERT OR UPDATE
  ON public.staff_branch_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_staff_branch_assignment();

-- ------------------------------------------------------------
-- 5. SAFE TRANSITION BACKFILL FROM existing public.staff.branch_id
--    - Only copies existing active staff rows with non-null branch_id.
--    - NULL staff.branch_id rows stay unassigned (0 rows).
--    - Does NOT touch protected workspace or unrelated single-tenant businesses.
-- ------------------------------------------------------------
INSERT INTO public.staff_branch_assignments (business_id, staff_id, branch_id)
SELECT s.business_id, s.id, s.branch_id
FROM public.staff s
JOIN public.branches b
  ON b.id = s.branch_id
 AND b.business_id = s.business_id
 AND b.is_active = true
WHERE s.branch_id IS NOT NULL
  AND s.deleted_at IS NULL
ON CONFLICT (staff_id, branch_id) DO NOTHING;

-- ------------------------------------------------------------
-- 6. RLS & PRIVILEGES ON public.staff_branch_assignments AND public.staff
-- ------------------------------------------------------------
ALTER TABLE public.staff_branch_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.staff_branch_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_branch_assignments TO authenticated;

DROP POLICY IF EXISTS "Business members can view staff branch assignments" ON public.staff_branch_assignments;
DROP POLICY IF EXISTS "Authorized salary manager can insert staff branch assignments" ON public.staff_branch_assignments;
DROP POLICY IF EXISTS "Authorized salary manager can update staff branch assignments" ON public.staff_branch_assignments;
DROP POLICY IF EXISTS "Authorized salary manager can delete staff branch assignments" ON public.staff_branch_assignments;

CREATE POLICY "Business members can view staff branch assignments"
  ON public.staff_branch_assignments
  FOR SELECT
  TO authenticated
  USING (
    public.is_salary_authorized(business_id)
    OR public.has_branch_access(business_id, branch_id, false)
  );

CREATE POLICY "Authorized salary manager can insert staff branch assignments"
  ON public.staff_branch_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_salary_authorized(business_id));

CREATE POLICY "Authorized salary manager can update staff branch assignments"
  ON public.staff_branch_assignments
  FOR UPDATE
  TO authenticated
  USING (public.is_salary_authorized(business_id))
  WITH CHECK (public.is_salary_authorized(business_id));

CREATE POLICY "Authorized salary manager can delete staff branch assignments"
  ON public.staff_branch_assignments
  FOR DELETE
  TO authenticated
  USING (public.is_salary_authorized(business_id));

-- Update public.staff SELECT policy so multi-branch Branch Staff see ONLY
-- teachers assigned to their branch in staff_branch_assignments (never unassigned).
-- Uses SECURITY DEFINER helpers so authenticated never needs direct SELECT on business_users or branches RLS chaining.
CREATE OR REPLACE FUNCTION public.is_multi_branch_business(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.business_id = p_business_id
  );
$$;

ALTER FUNCTION public.is_multi_branch_business(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_multi_branch_business(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_multi_branch_business(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_unscoped_business_viewer(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND (
        bu.role IN ('Creator', 'Admin')
        OR (bu.role = 'ReadOnly' AND bu.branch_id IS NULL)
      )
  );
$$;

ALTER FUNCTION public.is_unscoped_business_viewer(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_unscoped_business_viewer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_unscoped_business_viewer(UUID) TO authenticated;

DROP POLICY IF EXISTS "Business members can view staff directory" ON public.staff;

CREATE POLICY "Business members can view staff directory"
  ON public.staff
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      (
        NOT public.is_multi_branch_business(staff.business_id)
        AND staff.business_id IN (SELECT public.user_businesses())
      )
      OR (
        public.is_multi_branch_business(staff.business_id)
        AND (
          public.is_salary_authorized(staff.business_id)
          OR public.is_unscoped_business_viewer(staff.business_id)
          OR EXISTS (
            SELECT 1
            FROM public.staff_branch_assignments sba
            WHERE sba.staff_id = staff.id
              AND sba.business_id = staff.business_id
              AND public.has_branch_access(staff.business_id, sba.branch_id, false)
          )
        )
      )
    )
  );

-- ------------------------------------------------------------
-- 7. UPDATED & NEW SECURE RPCs
-- ------------------------------------------------------------

-- 7a. get_staff_directory: returns branch_ids UUID[] alongside safe directory fields.
--     Branch Staff see ONLY teachers assigned to their branch in staff_branch_assignments.
DROP FUNCTION IF EXISTS public.get_staff_directory(UUID);

CREATE OR REPLACE FUNCTION public.get_staff_directory(p_business_id UUID)
RETURNS TABLE (
  id UUID,
  business_id UUID,
  branch_id UUID,
  branch_ids UUID[],
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

  IF v_has_branches AND v_role = 'Staff' AND v_user_branch_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: Staff user is not assigned to a branch.';
  END IF;

  IF NOT v_has_branches OR v_role IN ('Creator', 'Admin') OR (v_role = 'ReadOnly' AND v_user_branch_id IS NULL) THEN
    RETURN QUERY
    SELECT
      s.id,
      s.business_id,
      s.branch_id,
      COALESCE(
        (
          SELECT ARRAY_AGG(sba.branch_id ORDER BY b.created_at, sba.branch_id)
          FROM public.staff_branch_assignments sba
          JOIN public.branches b ON b.id = sba.branch_id
          WHERE sba.staff_id = s.id
            AND sba.business_id = p_business_id
        ),
        ARRAY[]::UUID[]
      ) AS branch_ids,
      s.name,
      s.role,
      s.created_at
    FROM public.staff s
    WHERE s.business_id = p_business_id
      AND s.deleted_at IS NULL
    ORDER BY s.created_at DESC;
  ELSE
    RETURN QUERY
    SELECT
      s.id,
      s.business_id,
      v_user_branch_id AS branch_id,
      ARRAY[v_user_branch_id]::UUID[] AS branch_ids,
      s.name,
      s.role,
      s.created_at
    FROM public.staff s
    WHERE s.business_id = p_business_id
      AND s.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.staff_branch_assignments sba
        WHERE sba.staff_id = s.id
          AND sba.business_id = p_business_id
          AND sba.branch_id = v_user_branch_id
      )
    ORDER BY s.created_at DESC;
  END IF;
END;
$$;

ALTER FUNCTION public.get_staff_directory(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_staff_directory(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_directory(UUID) TO authenticated;

-- 7b. get_teachers_with_salary (Puan Hana ONLY): includes branch_ids UUID[]
DROP FUNCTION IF EXISTS public.get_teachers_with_salary(UUID);

CREATE OR REPLACE FUNCTION public.get_teachers_with_salary(p_business_id UUID)
RETURNS TABLE (
  id UUID,
  business_id UUID,
  branch_id UUID,
  branch_ids UUID[],
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
    COALESCE(
      (
        SELECT ARRAY_AGG(sba.branch_id ORDER BY b.created_at, sba.branch_id)
        FROM public.staff_branch_assignments sba
        JOIN public.branches b ON b.id = sba.branch_id
        WHERE sba.staff_id = s.id
          AND sba.business_id = p_business_id
      ),
      ARRAY[]::UUID[]
    ) AS branch_ids,
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

-- 7c. set_teacher_branch_assignments (Puan Hana ONLY)
DROP FUNCTION IF EXISTS public.set_teacher_branch_assignments(UUID, UUID, UUID[]);

CREATE OR REPLACE FUNCTION public.set_teacher_branch_assignments(
  p_business_id UUID,
  p_teacher_id UUID,
  p_branch_ids UUID[]
)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_branches BOOLEAN;
  v_clean_branch_ids UUID[] := ARRAY[]::UUID[];
  v_bid UUID;
  v_single_branch_id UUID;
BEGIN
  IF p_business_id IS NULL OR NOT public.is_salary_authorized(p_business_id) THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to manage teacher branch assignments.';
  END IF;

  IF p_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Teacher ID is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id = p_teacher_id
      AND s.business_id = p_business_id
      AND s.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Active teacher % not found in business %.', p_teacher_id, p_business_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.business_id = p_business_id
  ) INTO v_has_branches;

  IF p_branch_ids IS NOT NULL THEN
    FOREACH v_bid IN ARRAY p_branch_ids LOOP
      IF v_bid IS NULL THEN
        CONTINUE;
      END IF;
      IF NOT v_has_branches THEN
        RAISE EXCEPTION 'Invalid branch_id for single-tenant business %.', p_business_id;
      END IF;
      IF v_bid = ANY(v_clean_branch_ids) THEN
        RAISE EXCEPTION 'Duplicate branch assignment % is not allowed.', v_bid;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.branches b
        WHERE b.id = v_bid
          AND b.business_id = p_business_id
          AND b.is_active = true
      ) THEN
        RAISE EXCEPTION 'Invalid, cross-business, or inactive branch_id % for business %.', v_bid, p_business_id;
      END IF;
      v_clean_branch_ids := array_append(v_clean_branch_ids, v_bid);
    END LOOP;
  END IF;

  DELETE FROM public.staff_branch_assignments
  WHERE business_id = p_business_id
    AND staff_id = p_teacher_id
    AND NOT (branch_id = ANY(v_clean_branch_ids));

  IF cardinality(v_clean_branch_ids) > 0 THEN
    INSERT INTO public.staff_branch_assignments (business_id, staff_id, branch_id)
    SELECT p_business_id, p_teacher_id, unnest(v_clean_branch_ids)
    ON CONFLICT (staff_id, branch_id) DO NOTHING;
  END IF;

  v_single_branch_id := CASE
    WHEN cardinality(v_clean_branch_ids) = 1 THEN v_clean_branch_ids[1]
    ELSE NULL
  END;

  UPDATE public.staff
  SET branch_id = v_single_branch_id
  WHERE id = p_teacher_id
    AND business_id = p_business_id
    AND deleted_at IS NULL;

  RETURN COALESCE(
    (
      SELECT ARRAY_AGG(sba.branch_id ORDER BY b.created_at, sba.branch_id)
      FROM public.staff_branch_assignments sba
      JOIN public.branches b ON b.id = sba.branch_id
      WHERE sba.staff_id = p_teacher_id
        AND sba.business_id = p_business_id
    ),
    ARRAY[]::UUID[]
  );
END;
$$;

ALTER FUNCTION public.set_teacher_branch_assignments(UUID, UUID, UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_teacher_branch_assignments(UUID, UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_teacher_branch_assignments(UUID, UUID, UUID[]) TO authenticated;

-- 7d. save_teacher_with_salary (Puan Hana ONLY): backward compatible + p_branch_ids UUID[]
DROP FUNCTION IF EXISTS public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, UUID[]);

CREATE OR REPLACE FUNCTION public.save_teacher_with_salary(
  p_business_id UUID,
  p_name TEXT,
  p_role TEXT,
  p_phone TEXT,
  p_salary_type TEXT,
  p_salary_amount NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_teacher_id UUID DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_branch_ids UUID[] DEFAULT NULL
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
  v_should_sync_branches BOOLEAN := FALSE;
  v_target_branch_ids UUID[] := ARRAY[]::UUID[];
  v_bid UUID;
  v_single_branch_id UUID;
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

  IF p_branch_ids IS NOT NULL THEN
    v_should_sync_branches := TRUE;
    FOREACH v_bid IN ARRAY p_branch_ids LOOP
      IF v_bid IS NULL THEN
        CONTINUE;
      END IF;
      IF NOT v_has_branches THEN
        RAISE EXCEPTION 'Invalid branch_id for single-tenant business %.', p_business_id;
      END IF;
      IF v_bid = ANY(v_target_branch_ids) THEN
        RAISE EXCEPTION 'Duplicate branch assignment % is not allowed.', v_bid;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.branches b
        WHERE b.id = v_bid AND b.business_id = p_business_id AND b.is_active = true
      ) THEN
        RAISE EXCEPTION 'Invalid or inactive branch_id % for business %.', v_bid, p_business_id;
      END IF;
      v_target_branch_ids := array_append(v_target_branch_ids, v_bid);
    END LOOP;
  ELSIF p_branch_id IS NOT NULL THEN
    v_should_sync_branches := TRUE;
    IF NOT v_has_branches THEN
      RAISE EXCEPTION 'Invalid branch_id for single-tenant business %.', p_business_id;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = p_branch_id AND b.business_id = p_business_id AND b.is_active = true
    ) THEN
      RAISE EXCEPTION 'Invalid or inactive branch_id % for business %.', p_branch_id, p_business_id;
    END IF;
    v_target_branch_ids := ARRAY[p_branch_id];
  END IF;

  v_single_branch_id := CASE
    WHEN cardinality(v_target_branch_ids) = 1 THEN v_target_branch_ids[1]
    ELSE NULL
  END;

  IF p_teacher_id IS NOT NULL THEN
    UPDATE public.staff
    SET
      name = v_name_trimmed,
      role = COALESCE(NULLIF(TRIM(p_role), ''), 'Teacher'),
      phone = NULLIF(TRIM(p_phone), ''),
      salary_type = v_salary_type,
      salary_amount = v_salary_amount,
      notes = p_notes,
      branch_id = CASE
        WHEN v_should_sync_branches THEN v_single_branch_id
        ELSE branch_id
      END
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
      CASE WHEN v_should_sync_branches THEN v_single_branch_id ELSE NULL END,
      v_name_trimmed,
      COALESCE(NULLIF(TRIM(p_role), ''), 'Teacher'),
      NULLIF(TRIM(p_phone), ''),
      v_salary_type,
      v_salary_amount,
      p_notes
    )
    RETURNING id INTO v_id;
  END IF;

  IF v_should_sync_branches THEN
    DELETE FROM public.staff_branch_assignments
    WHERE business_id = p_business_id
      AND staff_id = v_id
      AND NOT (branch_id = ANY(v_target_branch_ids));

    IF cardinality(v_target_branch_ids) > 0 THEN
      INSERT INTO public.staff_branch_assignments (business_id, staff_id, branch_id)
      SELECT p_business_id, v_id, unnest(v_target_branch_ids)
      ON CONFLICT (staff_id, branch_id) DO NOTHING;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, UUID[]) TO authenticated;

-- ------------------------------------------------------------
-- 8. POST-MIGRATION INVARIANT CHECK (PROTECTED WORKSPACE UNTOUCHED)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_protected_biz_id CONSTANT UUID := 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';
  v_protected_rows INT;
BEGIN
  SELECT
    (SELECT COUNT(*) FROM public.branches WHERE business_id = v_protected_biz_id) +
    (SELECT COUNT(*) FROM public.staff_branch_assignments WHERE business_id = v_protected_biz_id) +
    (SELECT COUNT(*) FROM public.staff WHERE business_id = v_protected_biz_id AND branch_id IS NOT NULL)
  INTO v_protected_rows;

  IF v_protected_rows > 0 THEN
    RAISE EXCEPTION 'Safety invariant violated: Protected workspace % was modified.', v_protected_biz_id;
  END IF;
END $$;

COMMIT;
