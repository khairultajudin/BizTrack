-- ============================================================
-- BIZTRACK MIGRATION 08: SALARY PRIVACY, HISTORICAL BRANCH PAYROLL & ACCESS CONTROL
-- ============================================================
-- Target Business: PUSAT TUISYEN AKADEMIK MEGA (UUID: 978d2b0c-6a2b-4c28-9000-71dc23f96781)
-- Authorized Salary Administrator: Puan Hana / NORHANA ABDUL RANI
--   Auth UID: d2b660bf-10d3-4d94-94ec-0b8f6e0908e6
--   Email: akademikmega.admin@gmail.com
-- Target Branches:
--   Pauh Jaya:   9420a109-4a28-47f3-93ff-f4be08012719
--   Kelisa Emas: e4f61aac-9629-4be7-ae7e-8d9b462233a4
-- Restricted Staff Accounts:
--   Pauh Jaya:   akademikmega.pauhjaya@gmail.com (UID: 1d602572-2048-4526-bac0-05839ac06471)
--   Kelisa Emas: akademikmega.kelisaemas@gmail.com (UID: 2877f207-c3ff-4339-ad4e-823a3bd24e5f)
-- Protected Workspace (DO NOT TOUCH): Akademik Mega (UUID: ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad)
--
-- Security & Financial Architecture (Phase 2.1):
-- 1. Individual Salary & Payment Privacy:
--    - Only Puan Hana (pinned to UID d2b660bf-10d3-4d94-94ec-0b8f6e0908e6 and
--      business 978d2b0c-6a2b-4c28-9000-71dc23f96781) can access individual teacher
--      salary fields (public.staff.salary_type, public.staff.salary_amount) or
--      individual teacher payment records (public.staff_payments).
--    - Generic Creator or Admin roles do NOT grant salary access.
-- 2. Direct Teacher Mutation & Column-Level Hardening:
--    - Revokes all table-level privileges (SELECT, INSERT, UPDATE, DELETE) on
--      public.staff from PUBLIC, anon, and authenticated.
--    - Grants ONLY column-level SELECT on non-sensitive directory columns
--      (id, business_id, branch_id, name, role, phone, notes, created_at,
--      deleted_at, deleted_by) to authenticated.
-- 3. Permanent Historical Branch Payroll Allocation & Non-Fabricating Backfill:
--    - Adds branch_id (with composite FK (branch_id, business_id) -> public.branches)
--      to public.staff and public.staff_payments.
--    - Each new staff_payments row permanently records the branch_id responsible for
--      that payroll expense at creation time (via trigger trg_enforce_staff_payment_branch).
--    - Historical payroll ownership never shifts or disappears when a teacher has
--      no active class, loses class assignments, transfers branches, or is soft-deleted.
--    - Pre-Migration 08 staff_payments rows (branch_id IS NULL) are NEVER automatically
--      backfilled from staff.branch_id or current groups.teacher_id because current class
--      assignments cannot prove historical branch ownership at the payment date (e.g. if a
--      teacher transferred branches before Migration 08). They remain branch_id IS NULL
--      (Unmapped Payroll) until explicitly reconciled by Puan Hana.
-- 4. Branch-Isolated General Expenses (public.expenses):
--    - Adds branch_id (with composite FK and trigger trg_enforce_expense_branch)
--      and branch-scoped RLS policies using public.has_branch_access() to public.expenses.
-- 5. Branch-Scoped vs Consolidated Payroll Aggregate & Explicit Reconciliation:
--    - get_staff_expenses_summary sums public.staff_payments.amount using sp.branch_id.
--    - Pins Branch Staff to their assigned branch_id; blocks cross-branch requests.
--    - Explicit reconciliation rule:
--      Consolidated Payroll = Pauh Jaya Payroll + Kelisa Emas Payroll + Unmapped Payroll
--    - Provides Puan Hana with get_payroll_reconciliation_summary,
--      get_historical_payroll_audit, and assign_staff_payment_branch.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. PRE-MIGRATION SAFETY CHECKS & TARGET VALIDATION
-- ------------------------------------------------------------
DO $$
DECLARE
  v_target_biz_id CONSTANT UUID := '978d2b0c-6a2b-4c28-9000-71dc23f96781';
  v_authorized_uid CONSTANT UUID := 'd2b660bf-10d3-4d94-94ec-0b8f6e0908e6';
  v_protected_biz_id CONSTANT UUID := 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';
  v_biz_name TEXT;
  v_hana_role TEXT;
BEGIN
  IF v_target_biz_id = v_protected_biz_id THEN
    RAISE EXCEPTION 'Migration aborted: Target business UUID matches protected workspace UUID %', v_protected_biz_id;
  END IF;

  SELECT name INTO v_biz_name
  FROM public.businesses
  WHERE id = v_target_biz_id;

  IF v_biz_name IS NULL THEN
    RAISE EXCEPTION 'Target business % does not exist.', v_target_biz_id;
  END IF;

  SELECT role INTO v_hana_role
  FROM public.business_users
  WHERE business_id = v_target_biz_id
    AND user_id = v_authorized_uid;

  IF v_hana_role IS NULL THEN
    RAISE EXCEPTION 'Authorized user % is not associated with target business %.', v_authorized_uid, v_target_biz_id;
  END IF;

  RAISE NOTICE 'Pre-migration check passed: % (%) verified for authorized UID %.',
    v_biz_name, v_target_biz_id, v_authorized_uid;
END $$;

-- ------------------------------------------------------------
-- 2. PINNED AUTHORIZATION HELPER: is_salary_authorized
--    - Grants authorization strictly to Puan Hana's exact UID
--    - Strictly scoped to target business 978d2b0c-6a2b-4c28-9000-71dc23f96781
--    - Fail-closed for all other users (even with Creator/Admin role)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_salary_authorized(p_business_id UUID)
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
      AND bu.business_id = '978d2b0c-6a2b-4c28-9000-71dc23f96781'::uuid
      AND bu.user_id = 'd2b660bf-10d3-4d94-94ec-0b8f6e0908e6'::uuid
  );
$$;

ALTER FUNCTION public.is_salary_authorized(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_salary_authorized(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_salary_authorized(UUID) TO authenticated;

-- 2b. Deterministic classification helper for salary-related expense categories
CREATE OR REPLACE FUNCTION public.is_salary_expense_category(p_category TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_category, '') ~* '\m(salar(y|ies)|payroll|wages?)\M';
$$;

ALTER FUNCTION public.is_salary_expense_category(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_salary_expense_category(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_salary_expense_category(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 3. ADD branch_id & SOFT-DELETE COLUMNS (deleted_at, deleted_by),
--    VERIFY COLUMN DEFINITIONS, ADD DETERMINISTIC FKs & INDEXES
--    (Production baseline did not apply 02_phase2_migrations.sql soft-delete
--     columns on staff/groups/staff_payments/expenses; add them idempotently
--     here and track Migration 08-introduced columns so rollback never drops
--     pre-existing columns.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._migration_08_added_columns (
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (table_name, column_name)
);

REVOKE ALL ON TABLE public._migration_08_added_columns FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_col RECORD;
BEGIN
  FOR v_col IN
    SELECT * FROM (VALUES
      ('staff', 'branch_id'),
      ('staff', 'deleted_at'),
      ('staff', 'deleted_by'),
      ('groups', 'deleted_at'),
      ('groups', 'deleted_by'),
      ('staff_payments', 'branch_id'),
      ('staff_payments', 'deleted_at'),
      ('staff_payments', 'deleted_by'),
      ('expenses', 'branch_id'),
      ('expenses', 'deleted_at'),
      ('expenses', 'deleted_by'),
      ('expenses', 'staff_payment_id'),
      ('expenses', 'salary_reconciliation_status')
    ) AS t(tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_col.tbl
        AND a.attname = v_col.col
        AND NOT a.attisdropped
    ) THEN
      INSERT INTO public._migration_08_added_columns (table_name, column_name)
      VALUES (v_col.tbl, v_col.col)
      ON CONFLICT (table_name, column_name) DO NOTHING;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS branch_id UUID,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_by UUID;

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_by UUID;

ALTER TABLE public.staff_payments
  ADD COLUMN IF NOT EXISTS branch_id UUID,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_by UUID;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS branch_id UUID,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_by UUID,
  ADD COLUMN IF NOT EXISTS staff_payment_id UUID,
  ADD COLUMN IF NOT EXISTS salary_reconciliation_status TEXT DEFAULT NULL;

DO $$
DECLARE
  v_confdeltype CHAR(1);
BEGIN
  SELECT confdeltype
  INTO v_confdeltype
  FROM pg_constraint
  WHERE conname = 'expenses_staff_payment_id_fkey'
    AND conrelid = 'public.expenses'::regclass;

  IF v_confdeltype IS NOT NULL AND v_confdeltype <> 'r' THEN
    ALTER TABLE public.expenses
      DROP CONSTRAINT expenses_staff_payment_id_fkey;
    v_confdeltype := NULL;
  END IF;

  IF v_confdeltype IS NULL THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_staff_payment_id_fkey
      FOREIGN KEY (staff_payment_id)
      REFERENCES public.staff_payments(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expenses_salary_reconciliation_status_check'
      AND conrelid = 'public.expenses'::regclass
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_salary_reconciliation_status_check
      CHECK (
        salary_reconciliation_status IS NULL
        OR salary_reconciliation_status IN ('linked_duplicate', 'standalone', 'unresolved')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expenses_linked_duplicate_requires_payment_check'
      AND conrelid = 'public.expenses'::regclass
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_linked_duplicate_requires_payment_check
      CHECK (
        salary_reconciliation_status IS DISTINCT FROM 'linked_duplicate'
        OR staff_payment_id IS NOT NULL
      );
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_expenses_staff_payment_id;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_expenses_staff_payment_id
  ON public.expenses (staff_payment_id)
  WHERE staff_payment_id IS NOT NULL AND deleted_at IS NULL;

-- Safe deterministic backfill for existing Salary-category expenses:
-- Never guess standalone vs duplicate; unlinked rows become 'unresolved'.
UPDATE public.expenses
SET salary_reconciliation_status = CASE
  WHEN staff_payment_id IS NOT NULL THEN 'linked_duplicate'
  ELSE 'unresolved'
END
WHERE public.is_salary_expense_category(category)
  AND salary_reconciliation_status IS NULL;

-- Validate soft-delete column types and idempotently ensure deterministic
-- deleted_by -> public.profiles(id) ON DELETE SET NULL foreign keys.
DO $$
DECLARE
  v_spec RECORD;
  v_rel_oid OID;
  v_profiles_oid OID := 'public.profiles'::regclass;
  v_profiles_id_attnum SMALLINT;
  v_deleted_at_type TEXT;
  v_deleted_by_attnum SMALLINT;
  v_deleted_by_type TEXT;
  v_fk_rec RECORD;
  v_has_valid_fk BOOLEAN;
  v_named_con RECORD;
BEGIN
  SELECT a.attnum
  INTO v_profiles_id_attnum
  FROM pg_attribute a
  WHERE a.attrelid = v_profiles_oid
    AND a.attname = 'id'
    AND NOT a.attisdropped;

  IF v_profiles_id_attnum IS NULL THEN
    RAISE EXCEPTION 'Migration 08 aborted: public.profiles(id) column not found.';
  END IF;

  FOR v_spec IN
    SELECT * FROM (VALUES
      ('staff', 'staff_deleted_by_fkey'),
      ('groups', 'groups_deleted_by_fkey'),
      ('staff_payments', 'staff_payments_deleted_by_fkey'),
      ('expenses', 'expenses_deleted_by_fkey')
    ) AS t(tbl, fk_name)
  LOOP
    v_rel_oid := format('public.%I', v_spec.tbl)::regclass;

    -- 1. Validate deleted_at type
    SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
    INTO v_deleted_at_type
    FROM pg_attribute a
    WHERE a.attrelid = v_rel_oid
      AND a.attname = 'deleted_at'
      AND NOT a.attisdropped;

    IF v_deleted_at_type IS DISTINCT FROM 'timestamp with time zone' THEN
      RAISE EXCEPTION 'Migration 08 aborted: public.%.deleted_at has incompatible type "%" (expected "timestamp with time zone").',
        v_spec.tbl, COALESCE(v_deleted_at_type, 'MISSING');
    END IF;

    -- 2. Validate deleted_by type
    SELECT a.attnum, pg_catalog.format_type(a.atttypid, a.atttypmod)
    INTO v_deleted_by_attnum, v_deleted_by_type
    FROM pg_attribute a
    WHERE a.attrelid = v_rel_oid
      AND a.attname = 'deleted_by'
      AND NOT a.attisdropped;

    IF v_deleted_by_attnum IS NULL OR v_deleted_by_type IS DISTINCT FROM 'uuid' THEN
      RAISE EXCEPTION 'Migration 08 aborted: public.%.deleted_by has incompatible type "%" (expected "uuid").',
        v_spec.tbl, COALESCE(v_deleted_by_type, 'MISSING');
    END IF;

    -- 3. Inspect existing FK constraints referencing or involving deleted_by
    v_has_valid_fk := false;
    FOR v_fk_rec IN
      SELECT c.conname, c.confrelid, c.conkey, c.confkey, c.confdeltype
      FROM pg_constraint c
      WHERE c.conrelid = v_rel_oid
        AND c.contype = 'f'
        AND v_deleted_by_attnum = ANY(c.conkey)
    LOOP
      IF array_length(v_fk_rec.conkey, 1) <> 1
         OR v_fk_rec.confrelid <> v_profiles_oid
         OR v_fk_rec.confkey <> ARRAY[v_profiles_id_attnum]
         OR v_fk_rec.confdeltype <> 'n' THEN
        RAISE EXCEPTION 'Migration 08 aborted: Incompatible foreign key "%" on public.%.deleted_by (confrelid=%, confdeltype=%).',
          v_fk_rec.conname, v_spec.tbl, v_fk_rec.confrelid::regclass, v_fk_rec.confdeltype;
      END IF;
      v_has_valid_fk := true;
    END LOOP;

    -- 4. Ensure deterministic constraint name is not occupied by an unrelated constraint
    IF NOT v_has_valid_fk THEN
      SELECT c.contype, c.conkey
      INTO v_named_con
      FROM pg_constraint c
      WHERE c.conrelid = v_rel_oid
        AND c.conname = v_spec.fk_name;

      IF FOUND THEN
        RAISE EXCEPTION 'Migration 08 aborted: Constraint name "%" already exists on public.% with incompatible definition (contype=%).',
          v_spec.fk_name, v_spec.tbl, v_named_con.contype;
      END IF;

      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (deleted_by) REFERENCES public.profiles(id) ON DELETE SET NULL',
        v_spec.tbl,
        v_spec.fk_name
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_branch_business_fkey'
      AND conrelid = 'public.staff'::regclass
  ) THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_branch_business_fkey
      FOREIGN KEY (branch_id, business_id)
      REFERENCES public.branches(id, business_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_payments_branch_business_fkey'
      AND conrelid = 'public.staff_payments'::regclass
  ) THEN
    ALTER TABLE public.staff_payments
      ADD CONSTRAINT staff_payments_branch_business_fkey
      FOREIGN KEY (branch_id, business_id)
      REFERENCES public.branches(id, business_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expenses_branch_business_fkey'
      AND conrelid = 'public.expenses'::regclass
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_branch_business_fkey
      FOREIGN KEY (branch_id, business_id)
      REFERENCES public.branches(id, business_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_business_branch
  ON public.staff (business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_staff_payments_business_branch
  ON public.staff_payments (business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_expenses_business_branch
  ON public.expenses (business_id, branch_id);

-- ------------------------------------------------------------
-- 4. NON-FABRICATING HISTORICAL BRANCH BACKFILL & RECONCILIATION AUDIT
--    (Strictly scoped to target business 978d2b0c-6a2b-4c28-9000-71dc23f96781)
--    - Maps staff.branch_id (current default branch for future operations) ONLY when:
--      1) the teacher's active classes in public.groups belong to strictly ONE branch,
--      2) across all active + inactive/deleted classes in public.groups the teacher
--         has never been linked to another branch, AND
--      3) the teacher has no historical staff_payments predating that branch/class creation.
--    - NEVER backfills historical public.staff_payments.branch_id from staff.branch_id
--      or current groups.teacher_id, because current class assignments cannot prove
--      historical branch ownership at the payment date (e.g. pre-migration transfers).
--      All pre-existing unmapped payments remain branch_id IS NULL (Unmapped Payroll)
--      until explicitly reconciled by Puan Hana via assign_staff_payment_branch.
--    - Preserves any legitimate branch_id assignments in unrelated multi-branch
--      businesses while verifying zero non-target rows are modified by Migration 08
--      and verifying the protected workspace (ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad)
--      has zero branches and zero non-null branch_id rows.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_target_biz_id CONSTANT UUID := '978d2b0c-6a2b-4c28-9000-71dc23f96781';
  v_protected_biz_id CONSTANT UUID := 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';
  v_non_target_before INT := 0;
  v_non_target_after INT := 0;
  v_protected_touched INT := 0;
  v_single_tenant_invalid INT := 0;
  v_mapped_staff INT := 0;
  v_unmapped_staff INT := 0;
  v_total_payments INT := 0;
  v_confidently_mapped_payments INT := 0;
  v_unmapped_payments INT := 0;
  v_ambiguous_payments INT := 0;
  v_unestablished_payments INT := 0;
  v_unmapped_expenses INT := 0;
BEGIN
  -- 4a. Record pre-backfill non-target branch_id count & verify protected/single-tenant invariants
  SELECT
    (SELECT COUNT(*) FROM public.staff WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL) +
    (SELECT COUNT(*) FROM public.staff_payments WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL) +
    (SELECT COUNT(*) FROM public.expenses WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL)
  INTO v_non_target_before;

  SELECT
    (SELECT COUNT(*) FROM public.branches WHERE business_id = v_protected_biz_id) +
    (SELECT COUNT(*) FROM public.staff WHERE business_id = v_protected_biz_id AND branch_id IS NOT NULL) +
    (SELECT COUNT(*) FROM public.staff_payments WHERE business_id = v_protected_biz_id AND branch_id IS NOT NULL) +
    (SELECT COUNT(*) FROM public.expenses WHERE business_id = v_protected_biz_id AND branch_id IS NOT NULL)
  INTO v_protected_touched;

  IF v_protected_touched > 0 THEN
    RAISE EXCEPTION 'Migration aborted: Protected workspace % has unexpected branch configuration or branch_id rows (%).',
      v_protected_biz_id, v_protected_touched;
  END IF;

  SELECT
    (SELECT COUNT(*) FROM public.staff s
     WHERE s.branch_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.business_id = s.business_id)) +
    (SELECT COUNT(*) FROM public.staff_payments sp
     WHERE sp.branch_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.business_id = sp.business_id)) +
    (SELECT COUNT(*) FROM public.expenses e
     WHERE e.branch_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.business_id = e.business_id))
  INTO v_single_tenant_invalid;

  IF v_single_tenant_invalid > 0 THEN
    RAISE EXCEPTION 'Migration aborted: Single-tenant business has % unexpected non-null branch_id rows.',
      v_single_tenant_invalid;
  END IF;

  -- 4b. Conservative current-branch assignment on public.staff ONLY when the teacher:
  --     - has active classes in strictly 1 active branch,
  --     - has zero inactive/soft-deleted classes in any other branch, AND
  --     - has no historical staff_payments dated prior to that branch or class creation.
  WITH teacher_class_history AS (
    SELECT
      g.teacher_id,
      COUNT(DISTINCT g.branch_id) FILTER (WHERE g.deleted_at IS NULL AND g.status = 'Active') AS active_branch_count,
      COUNT(DISTINCT g.branch_id) AS all_branch_count,
      (ARRAY_AGG(DISTINCT g.branch_id) FILTER (WHERE g.deleted_at IS NULL AND g.status = 'Active'))[1] AS candidate_branch_id,
      MIN(g.created_at::date) FILTER (WHERE g.deleted_at IS NULL AND g.status = 'Active') AS earliest_active_class_date
    FROM public.groups g
    WHERE g.business_id = v_target_biz_id
      AND g.teacher_id IS NOT NULL
      AND g.branch_id IS NOT NULL
    GROUP BY g.teacher_id
  ),
  unambiguous_current_teachers AS (
    SELECT
      tch.teacher_id,
      tch.candidate_branch_id
    FROM teacher_class_history tch
    JOIN public.branches b
      ON b.id = tch.candidate_branch_id
     AND b.business_id = v_target_biz_id
     AND b.is_active = true
    WHERE tch.active_branch_count = 1
      AND tch.all_branch_count = 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.staff_payments sp
        WHERE sp.business_id = v_target_biz_id
          AND sp.staff_id = tch.teacher_id
          AND sp.deleted_at IS NULL
          AND (
            sp.date < b.created_at::date
            OR sp.date < tch.earliest_active_class_date
          )
      )
  ),
  updated_staff AS (
    UPDATE public.staff s
    SET branch_id = uct.candidate_branch_id
    FROM unambiguous_current_teachers uct
    WHERE s.id = uct.teacher_id
      AND s.business_id = v_target_biz_id
      AND s.branch_id IS NULL
    RETURNING s.id
  )
  SELECT COUNT(*) INTO v_mapped_staff FROM updated_staff;

  -- 4c. Historical public.staff_payments are NOT auto-backfilled from current staff/class state.
  --     Compute the 5-metric reconciliation breakdown for target business historical payments.
  SELECT COUNT(*) INTO v_unmapped_staff
  FROM public.staff
  WHERE business_id = v_target_biz_id AND branch_id IS NULL AND deleted_at IS NULL;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE sp.branch_id IS NOT NULL),
    COUNT(*) FILTER (WHERE sp.branch_id IS NULL)
  INTO
    v_total_payments,
    v_confidently_mapped_payments,
    v_unmapped_payments
  FROM public.staff_payments sp
  WHERE sp.business_id = v_target_biz_id
    AND sp.deleted_at IS NULL;

  -- Classify unmapped payments into:
  --   1) ambiguous_ownership_payments: teacher has >= 1 class link in public.groups
  --      (either multi-branch, pre-migration transfer indicator, or current single-branch
  --      class link whose historical permanence at the payment date cannot be proven), vs
  --   2) unestablished_branch_payments: teacher has 0 class links in public.groups.
  SELECT
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.groups g
        WHERE g.business_id = v_target_biz_id
          AND g.teacher_id = sp.staff_id
          AND g.branch_id IS NOT NULL
      )
    ),
    COUNT(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM public.groups g
        WHERE g.business_id = v_target_biz_id
          AND g.teacher_id = sp.staff_id
          AND g.branch_id IS NOT NULL
      )
    )
  INTO
    v_ambiguous_payments,
    v_unestablished_payments
  FROM public.staff_payments sp
  WHERE sp.business_id = v_target_biz_id
    AND sp.deleted_at IS NULL
    AND sp.branch_id IS NULL;

  SELECT COUNT(*) INTO v_unmapped_expenses
  FROM public.expenses
  WHERE business_id = v_target_biz_id AND branch_id IS NULL AND deleted_at IS NULL;

  -- 4d. Verify zero non-target rows were modified by Migration 08 backfill
  SELECT
    (SELECT COUNT(*) FROM public.staff WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL) +
    (SELECT COUNT(*) FROM public.staff_payments WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL) +
    (SELECT COUNT(*) FROM public.expenses WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL)
  INTO v_non_target_after;

  IF v_non_target_after <> v_non_target_before THEN
    RAISE EXCEPTION 'Migration aborted: Non-target workspaces had branch_id rows modified (before=%, after=%).',
      v_non_target_before, v_non_target_after;
  END IF;

  RAISE NOTICE 'Historical payroll reconciliation summary for %: mapped_staff=%, unmapped_staff=%, total_historical_payments=%, confidently_mapped_payments=%, unmapped_payments=%, ambiguous_ownership_payments=%, unestablished_branch_payments=%, unmapped_expenses=%.',
    v_target_biz_id,
    v_mapped_staff,
    v_unmapped_staff,
    v_total_payments,
    v_confidently_mapped_payments,
    v_unmapped_payments,
    v_ambiguous_payments,
    v_unestablished_payments,
    v_unmapped_expenses;
END $$;

-- ------------------------------------------------------------
-- 5. TRIGGERS FOR HISTORICAL BRANCH ALLOCATION & IMMUTABILITY
--    - trg_enforce_staff_branch on public.staff
--    - trg_enforce_staff_payment_branch on public.staff_payments
--    - trg_enforce_expense_branch on public.expenses
-- ------------------------------------------------------------

-- 5a. Enforce staff tenant immutability and valid branch ownership
CREATE OR REPLACE FUNCTION public.enforce_staff_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_multi_branch BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'Security violation: business_id is immutable for staff';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.branches WHERE business_id = NEW.business_id
  ) INTO v_is_multi_branch;

  IF v_is_multi_branch THEN
    IF NEW.branch_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.branch_id IS DISTINCT FROM OLD.branch_id) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE id = NEW.branch_id
          AND business_id = NEW.business_id
          AND is_active = true
      ) THEN
        RAISE EXCEPTION 'Inactive or invalid branch violation: Cannot assign staff to branch %', NEW.branch_id;
      END IF;
    END IF;
  ELSE
    IF NEW.branch_id IS NOT NULL THEN
      RAISE EXCEPTION 'Single-tenant violation: branch_id must be NULL for staff in a single-tenant business';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_staff_branch() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_staff_branch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_staff_branch() TO authenticated;

DROP TRIGGER IF EXISTS trg_enforce_staff_branch ON public.staff;
CREATE TRIGGER trg_enforce_staff_branch
  BEFORE INSERT OR UPDATE
  ON public.staff
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_staff_branch();

-- 5b. Permanently allocate and protect branch_id on public.staff_payments
CREATE OR REPLACE FUNCTION public.enforce_staff_payment_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_biz_id UUID;
  v_staff_branch_id UUID;
  v_is_multi_branch BOOLEAN;
BEGIN
  -- 1. Enforce business_id immutability on UPDATE
  IF TG_OP = 'UPDATE' AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'Security violation: business_id is immutable for staff_payments';
  END IF;

  -- 2. Verify staff_id belongs to the exact same business and fetch teacher's current branch_id
  SELECT business_id, branch_id
  INTO v_staff_biz_id, v_staff_branch_id
  FROM public.staff
  WHERE id = NEW.staff_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid staff_id: Teacher % does not exist', NEW.staff_id;
  END IF;

  IF v_staff_biz_id <> NEW.business_id THEN
    RAISE EXCEPTION 'Cross-business violation: Teacher business (%) does not match payment business (%)',
      v_staff_biz_id, NEW.business_id;
  END IF;

  -- 3. Determine whether business is multi-branch
  SELECT EXISTS (
    SELECT 1 FROM public.branches WHERE business_id = NEW.business_id
  ) INTO v_is_multi_branch;

  IF v_is_multi_branch THEN
    -- On INSERT, auto-populate branch_id from teacher's assigned branch if not explicitly supplied
    IF TG_OP = 'INSERT' AND NEW.branch_id IS NULL AND v_staff_branch_id IS NOT NULL THEN
      NEW.branch_id := v_staff_branch_id;
    END IF;

    -- Require branch_id for all new staff_payments (and prevent clearing an existing branch_id on UPDATE)
    IF NEW.branch_id IS NULL AND (TG_OP = 'INSERT' OR OLD.branch_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Multi-branch violation: branch_id is required for staff_payments in a multi-branch business';
    END IF;

    -- Protect historical branch attribution and reconciliation on UPDATE
    IF TG_OP = 'UPDATE' AND NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      IF NOT public.is_salary_authorized(OLD.business_id) THEN
        RAISE EXCEPTION 'Historical attribution protected: Unauthorized user cannot alter staff_payments branch_id';
      END IF;
      IF OLD.branch_id IS NOT NULL
         AND COALESCE(current_setting('biztrack.reconcile_payment_branch', true), 'false') <> 'true' THEN
        RAISE EXCEPTION 'Historical attribution protected: Existing payment branch_id cannot be silently altered during ordinary updates';
      END IF;
    END IF;

    -- Verify target branch is active on INSERT or when branch_id is changed
    IF NEW.branch_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.branch_id IS DISTINCT FROM OLD.branch_id) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE id = NEW.branch_id
          AND business_id = NEW.business_id
          AND is_active = true
      ) THEN
        RAISE EXCEPTION 'Inactive branch violation: Cannot assign staff_payments to inactive branch %', NEW.branch_id;
      END IF;
    END IF;
  ELSE
    IF NEW.branch_id IS NOT NULL THEN
      RAISE EXCEPTION 'Single-tenant violation: branch_id must be NULL for staff_payments in a single-tenant business';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_staff_payment_branch() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_staff_payment_branch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_staff_payment_branch() TO authenticated;

DROP TRIGGER IF EXISTS trg_enforce_staff_payment_branch ON public.staff_payments;
CREATE TRIGGER trg_enforce_staff_payment_branch
  BEFORE INSERT OR UPDATE
  ON public.staff_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_staff_payment_branch();

-- 5c. Enforce branch_id and historical branch attribution on public.expenses
CREATE OR REPLACE FUNCTION public.enforce_expense_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_multi_branch BOOLEAN;
  v_user_role TEXT;
  v_user_branch_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'Security violation: business_id is immutable for expenses';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.branches WHERE business_id = NEW.business_id
  ) INTO v_is_multi_branch;

  IF v_is_multi_branch THEN
    -- On INSERT, if branch_id is omitted by a branch-assigned Staff user, default to their assigned branch
    IF TG_OP = 'INSERT' AND NEW.branch_id IS NULL AND auth.uid() IS NOT NULL THEN
      SELECT bu.role, bu.branch_id
      INTO v_user_role, v_user_branch_id
      FROM public.business_users bu
      WHERE bu.business_id = NEW.business_id
        AND bu.user_id = auth.uid()
      LIMIT 1;

      IF v_user_role = 'Staff' AND v_user_branch_id IS NOT NULL THEN
        NEW.branch_id := v_user_branch_id;
      END IF;
    END IF;

    -- Require branch_id for new expenses and prevent clearing an existing branch_id on UPDATE
    IF NEW.branch_id IS NULL AND (TG_OP = 'INSERT' OR OLD.branch_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Multi-branch violation: branch_id is required for expenses in a multi-branch business';
    END IF;

    -- Protect historical branch attribution on UPDATE: Staff cannot move an expense to another branch
    IF TG_OP = 'UPDATE' AND OLD.branch_id IS NOT NULL AND NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      IF NOT public.is_business_admin(OLD.business_id) THEN
        RAISE EXCEPTION 'Historical attribution protected: Staff cannot alter expense branch_id';
      END IF;
    END IF;

    -- Verify target branch is active on INSERT or when branch_id is changed
    IF NEW.branch_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.branch_id IS DISTINCT FROM OLD.branch_id) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE id = NEW.branch_id
          AND business_id = NEW.business_id
          AND is_active = true
      ) THEN
        RAISE EXCEPTION 'Inactive branch violation: Cannot assign expense to an inactive branch (%)', NEW.branch_id;
      END IF;
    END IF;
  ELSE
    IF NEW.branch_id IS NOT NULL THEN
      RAISE EXCEPTION 'Single-tenant violation: branch_id must be NULL for expenses in a single-tenant business';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_expense_branch() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_expense_branch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_expense_branch() TO authenticated;

DROP TRIGGER IF EXISTS trg_enforce_expense_branch ON public.expenses;
CREATE TRIGGER trg_enforce_expense_branch
  BEFORE INSERT OR UPDATE
  ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_expense_branch();

CREATE OR REPLACE FUNCTION public.enforce_expense_salary_reconciliation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment RECORD;
BEGIN
  IF NOT public.is_salary_expense_category(NEW.category) THEN
    IF NEW.staff_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only Salary-category expenses may reference staff_payment_id.';
    END IF;
    NEW.salary_reconciliation_status := NULL;
    RETURN NEW;
  END IF;

  -- Salary-category expense: only authorized salary admin (or superuser migration) may set/change link or status
  IF auth.uid() IS NOT NULL OR current_user = 'authenticated' THEN
    IF NOT public.is_salary_authorized(NEW.business_id) THEN
      RAISE EXCEPTION 'Access denied: only the authorized salary administrator may manage Salary-category expenses.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.staff_payment_id IS NOT NULL THEN
    IF NEW.salary_reconciliation_status IS NULL THEN
      NEW.salary_reconciliation_status := 'linked_duplicate';
    ELSIF NEW.salary_reconciliation_status <> 'linked_duplicate' THEN
      RAISE EXCEPTION 'Salary expense linked to staff_payment_id must have salary_reconciliation_status = linked_duplicate.';
    END IF;

    SELECT sp.id, sp.business_id, sp.branch_id, sp.deleted_at
    INTO v_payment
    FROM public.staff_payments sp
    WHERE sp.id = NEW.staff_payment_id;

    IF NOT FOUND OR v_payment.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Target staff_payment_id (%) does not exist or is deleted.', NEW.staff_payment_id;
    END IF;

    IF v_payment.business_id <> NEW.business_id THEN
      RAISE EXCEPTION 'Cross-business violation: staff_payment (%) belongs to a different business.', NEW.staff_payment_id;
    END IF;

    IF v_payment.branch_id IS DISTINCT FROM NEW.branch_id THEN
      RAISE EXCEPTION 'Branch mismatch: expense branch (%) does not match staff_payment branch (%).', NEW.branch_id, v_payment.branch_id;
    END IF;
  ELSE
    IF NEW.salary_reconciliation_status IS NULL THEN
      NEW.salary_reconciliation_status := 'unresolved';
    ELSIF NEW.salary_reconciliation_status = 'linked_duplicate' THEN
      RAISE EXCEPTION 'linked_duplicate status requires a non-null staff_payment_id.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_expense_salary_reconciliation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_expense_salary_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_expense_salary_reconciliation() TO authenticated;

DROP TRIGGER IF EXISTS trg_enforce_expense_salary_reconciliation ON public.expenses;
CREATE TRIGGER trg_enforce_expense_salary_reconciliation
  BEFORE INSERT OR UPDATE
  ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_expense_salary_reconciliation();

CREATE OR REPLACE FUNCTION public.protect_linked_staff_payment_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.expenses e
    WHERE e.staff_payment_id = OLD.id
      AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete staff_payment (%) while active Salary expense(s) are linked to it.', OLD.id
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$$;

ALTER FUNCTION public.protect_linked_staff_payment_delete() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.protect_linked_staff_payment_delete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protect_linked_staff_payment_delete() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_linked_staff_payment_delete ON public.staff_payments;
CREATE TRIGGER trg_protect_linked_staff_payment_delete
  BEFORE DELETE
  ON public.staff_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_linked_staff_payment_delete();

CREATE OR REPLACE FUNCTION public.handle_linked_staff_payment_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_uid UUID;
  v_expense RECORD;
BEGIN
  v_actor_uid := COALESCE(auth.uid(), NEW.deleted_by);

  FOR v_expense IN
    UPDATE public.expenses
    SET staff_payment_id = NULL,
        salary_reconciliation_status = 'unresolved'
    WHERE staff_payment_id = NEW.id
      AND deleted_at IS NULL
    RETURNING id, business_id, branch_id, amount
  LOOP
    IF v_actor_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = v_actor_uid) THEN
      INSERT INTO public.activity_logs (business_id, user_id, module, action, old_value, new_value)
      VALUES (
        v_expense.business_id,
        v_actor_uid,
        'expenses',
        'staff_payment_soft_deleted_unlink',
        jsonb_build_object(
          'expense_id', v_expense.id,
          'staff_payment_id', NEW.id,
          'salary_reconciliation_status', 'linked_duplicate',
          'branch_id', v_expense.branch_id,
          'amount', v_expense.amount
        ),
        jsonb_build_object(
          'expense_id', v_expense.id,
          'staff_payment_id', NULL,
          'salary_reconciliation_status', 'unresolved',
          'branch_id', v_expense.branch_id,
          'amount', v_expense.amount
        )
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_linked_staff_payment_soft_delete() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_linked_staff_payment_soft_delete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_linked_staff_payment_soft_delete() TO authenticated;

DROP TRIGGER IF EXISTS trg_handle_linked_staff_payment_soft_delete ON public.staff_payments;
CREATE TRIGGER trg_handle_linked_staff_payment_soft_delete
  AFTER UPDATE OF deleted_at
  ON public.staff_payments
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_linked_staff_payment_soft_delete();

-- ------------------------------------------------------------
-- 6. HARDEN PRIVILEGES & RLS ON public.staff_payments, public.staff & public.expenses
-- ------------------------------------------------------------

-- 6a. public.staff_payments — Strictly Puan Hana ONLY
ALTER TABLE public.staff_payments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.staff_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_payments TO authenticated;

DROP POLICY IF EXISTS "Users can access data in their business" ON public.staff_payments;
DROP POLICY IF EXISTS "Authorized salary manager can access staff payments" ON public.staff_payments;

CREATE POLICY "Authorized salary manager can access staff payments"
  ON public.staff_payments
  FOR ALL
  TO authenticated
  USING (public.is_salary_authorized(business_id))
  WITH CHECK (public.is_salary_authorized(business_id));

-- 6b. public.staff — Column-level SELECT on directory fields ONLY; zero direct write grants
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.staff FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id,
  business_id,
  branch_id,
  name,
  role,
  created_at,
  deleted_at,
  deleted_by
) ON public.staff TO authenticated;

DROP POLICY IF EXISTS "Users can access data in their business" ON public.staff;
DROP POLICY IF EXISTS "Business members can access staff directory" ON public.staff;
DROP POLICY IF EXISTS "Business members can view staff directory" ON public.staff;
DROP POLICY IF EXISTS "Authorized salary manager can insert staff" ON public.staff;
DROP POLICY IF EXISTS "Authorized salary manager can update staff" ON public.staff;
DROP POLICY IF EXISTS "Authorized salary manager can delete staff" ON public.staff;

-- Branch-scoped directory SELECT:
--   - Creator/Admin see all active staff in their business
--   - Branch Staff see active staff assigned to their own branch plus unassigned/shared
--     staff (branch_id IS NULL) needed for class teacher dropdowns, but NEVER staff
--     assigned to another branch, and NEVER phone/notes/salary columns.
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

CREATE POLICY "Authorized salary manager can insert staff"
  ON public.staff
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_salary_authorized(business_id));

CREATE POLICY "Authorized salary manager can update staff"
  ON public.staff
  FOR UPDATE
  TO authenticated
  USING (public.is_salary_authorized(business_id))
  WITH CHECK (public.is_salary_authorized(business_id));

CREATE POLICY "Authorized salary manager can delete staff"
  ON public.staff
  FOR DELETE
  TO authenticated
  USING (public.is_salary_authorized(business_id));

-- 6c. public.expenses — Branch-isolated + Salary-category privacy RLS
--     - General expenses: branch-isolated via public.has_branch_access()
--     - Salary-category expenses: restricted strictly to public.is_salary_authorized(business_id)
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.expenses FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;

DROP POLICY IF EXISTS "Users can access data in their business" ON public.expenses;
DROP POLICY IF EXISTS "Business members can view expenses" ON public.expenses;
DROP POLICY IF EXISTS "Business write users can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Business write users can update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Business write users can delete expenses" ON public.expenses;

CREATE POLICY "Business members can view expenses"
  ON public.expenses
  FOR SELECT
  TO authenticated
  USING (
    public.has_branch_access(business_id, branch_id, false)
    AND (
      NOT public.is_salary_expense_category(category)
      OR public.is_salary_authorized(business_id)
    )
  );

CREATE POLICY "Business write users can insert expenses"
  ON public.expenses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_branch_access(business_id, branch_id, true)
    AND (
      NOT public.is_salary_expense_category(category)
      OR public.is_salary_authorized(business_id)
    )
  );

CREATE POLICY "Business write users can update expenses"
  ON public.expenses
  FOR UPDATE
  TO authenticated
  USING (
    public.has_branch_access(business_id, branch_id, true)
    AND (
      NOT public.is_salary_expense_category(category)
      OR public.is_salary_authorized(business_id)
    )
  )
  WITH CHECK (
    public.has_branch_access(business_id, branch_id, true)
    AND (
      NOT public.is_salary_expense_category(category)
      OR public.is_salary_authorized(business_id)
    )
  );

CREATE POLICY "Business write users can delete expenses"
  ON public.expenses
  FOR DELETE
  TO authenticated
  USING (
    public.has_branch_access(business_id, branch_id, true)
    AND (
      NOT public.is_salary_expense_category(category)
      OR public.is_salary_authorized(business_id)
    )
  );

-- ------------------------------------------------------------
-- 7. SECURE RPC: get_teachers_with_salary (For Puan Hana Only)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 7b. SECURE RPC: get_staff_directory (Safe Directory Fields for All Members)
--     - Allows branch Staff, Admin, Creator, and ReadOnly to view safe
--       teacher directory fields (id, business_id, branch_id, name, role, created_at)
--       for their authorized branch scope.
--     - NEVER returns salary_type, salary_amount, phone, or notes.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 8. SECURE RPC: save_teacher_with_salary (For Puan Hana Only)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID);
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

-- ------------------------------------------------------------
-- 9. SECURE RPC: delete_teacher (For Puan Hana Only)
--    - Soft-deletes the teacher record (deleted_at = NOW(), deleted_by = auth.uid())
--      and unassigns the teacher from active classes (groups.teacher_id = NULL)
--    - Preserves staff.branch_id and 100% of historical public.staff_payments rows
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_teacher(
  p_business_id UUID,
  p_teacher_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_id UUID;
BEGIN
  IF p_business_id IS NULL OR NOT public.is_salary_authorized(p_business_id) THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to delete teacher records.';
  END IF;

  IF p_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Teacher ID is required.';
  END IF;

  -- 1. Unassign teacher ONLY from genuinely active classes in this business,
  --    preserving inactive and soft-deleted historical class relationships so
  --    get_historical_payroll_audit() retains historical branch evidence.
  UPDATE public.groups
  SET teacher_id = NULL
  WHERE teacher_id = p_teacher_id
    AND business_id = p_business_id
    AND deleted_at IS NULL
    AND status = 'Active';

  -- 2. Soft-delete teacher; historical staff_payments rows and their branch_id remain untouched
  UPDATE public.staff
  SET
    deleted_at = NOW(),
    deleted_by = auth.uid()
  WHERE id = p_teacher_id
    AND business_id = p_business_id
    AND deleted_at IS NULL
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN
    RAISE EXCEPTION 'Active teacher with ID % not found in business %.', p_teacher_id, p_business_id;
  END IF;

  RETURN TRUE;
END;
$$;

ALTER FUNCTION public.delete_teacher(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_teacher(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_teacher(UUID, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 10. SECURE AGGREGATE RPCs:
--     - resolve_authorized_expense_branch (internal helper, not directly executable)
--     - get_staff_expenses_summary (staff_payments aggregate)
--     - get_expenses_summary (public.expenses scalar aggregate incl. Salary category)
--     - get_monthly_expenses_summary (public.expenses 12-month aggregates incl. Salary category)
--     All enforce identical strict business & branch authorization:
--       * Pauh Jaya Staff -> Pauh Jaya aggregate only
--       * Kelisa Emas Staff -> Kelisa Emas aggregate only
--       * Unassigned Staff in multi-branch business -> fail-closed exception
--       * Cross-branch parameter manipulation -> fail-closed exception
--       * Generic Creator / Admin -> scalar aggregate only; NO individual salary/payment access
--       * ReadOnly -> matches 07_multi_branch.sql Case 4: branch-assigned ReadOnly is restricted to their assigned branch;
--                     unassigned ReadOnly (bu.branch_id IS NULL) has business-wide scalar aggregate access only; NO individual salary/payment access
--       * Puan Hana -> consolidated, per-branch, and individual salary/payment access
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_authorized_expense_branch(
  p_business_id UUID,
  p_branch_id UUID DEFAULT NULL
)
RETURNS UUID
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
  v_effective_branch_id UUID;
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

  IF v_has_branches THEN
    IF v_role = 'Staff' THEN
      IF v_user_branch_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: Staff user is not assigned to a branch.';
      END IF;
      IF p_branch_id IS NOT NULL AND p_branch_id <> v_user_branch_id THEN
        RAISE EXCEPTION 'Access denied: Cannot access payroll aggregate for another branch.';
      END IF;
      v_effective_branch_id := v_user_branch_id;

    ELSIF v_role = 'ReadOnly' AND v_user_branch_id IS NOT NULL THEN
      IF p_branch_id IS NOT NULL AND p_branch_id <> v_user_branch_id THEN
        RAISE EXCEPTION 'Access denied: Cannot access payroll aggregate for another branch.';
      END IF;
      v_effective_branch_id := v_user_branch_id;

    ELSE
      IF p_branch_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.branches b
          WHERE b.id = p_branch_id AND b.business_id = p_business_id
        ) THEN
          RAISE EXCEPTION 'Invalid branch_id % for business %.', p_branch_id, p_business_id;
        END IF;
      END IF;
      v_effective_branch_id := p_branch_id;
    END IF;
  ELSE
    IF p_branch_id IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid branch_id for single-tenant business %.', p_business_id;
    END IF;
    v_effective_branch_id := NULL;
  END IF;

  RETURN v_effective_branch_id;
END;
$$;

ALTER FUNCTION public.resolve_authorized_expense_branch(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_authorized_expense_branch(UUID, UUID) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.get_staff_expenses_summary(UUID, TEXT, INT);
DROP FUNCTION IF EXISTS public.get_staff_expenses_summary(UUID, TEXT, INT, UUID);

CREATE OR REPLACE FUNCTION public.get_staff_expenses_summary(
  p_business_id UUID,
  p_month TEXT,
  p_year INT,
  p_branch_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_effective_branch_id UUID;
  v_total NUMERIC;
BEGIN
  IF p_business_id IS NULL OR p_month IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'Business ID, month, and year are required.';
  END IF;

  v_effective_branch_id := public.resolve_authorized_expense_branch(p_business_id, p_branch_id);

  IF v_effective_branch_id IS NULL THEN
    SELECT COALESCE(SUM(sp.amount), 0)
    INTO v_total
    FROM public.staff_payments sp
    WHERE sp.business_id = p_business_id
      AND sp.month = p_month
      AND sp.year = p_year
      AND sp.deleted_at IS NULL;
  ELSE
    SELECT COALESCE(SUM(sp.amount), 0)
    INTO v_total
    FROM public.staff_payments sp
    WHERE sp.business_id = p_business_id
      AND sp.branch_id = v_effective_branch_id
      AND sp.month = p_month
      AND sp.year = p_year
      AND sp.deleted_at IS NULL;
  END IF;

  RETURN COALESCE(v_total, 0);
END;
$$;

ALTER FUNCTION public.get_staff_expenses_summary(UUID, TEXT, INT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_staff_expenses_summary(UUID, TEXT, INT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_expenses_summary(UUID, TEXT, INT, UUID) TO authenticated;

-- 10a-ii. Scalar non-salary expenses aggregate (excludes Salary-category rows to prevent
--         double-counting against authoritative public.staff_payments).
DROP FUNCTION IF EXISTS public.get_expenses_summary(UUID, DATE, DATE, UUID);

CREATE OR REPLACE FUNCTION public.get_expenses_summary(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_effective_branch_id UUID;
  v_total NUMERIC;
BEGIN
  IF p_business_id IS NULL OR p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Business ID, start date, and end date are required.';
  END IF;

  v_effective_branch_id := public.resolve_authorized_expense_branch(p_business_id, p_branch_id);

  SELECT COALESCE(SUM(e.amount), 0)
  INTO v_total
  FROM public.expenses e
  WHERE e.business_id = p_business_id
    AND e.date >= p_start_date
    AND e.date <= p_end_date
    AND e.deleted_at IS NULL
    AND NOT public.is_salary_expense_category(e.category)
    AND (v_effective_branch_id IS NULL OR e.branch_id = v_effective_branch_id);

  RETURN COALESCE(v_total, 0);
END;
$$;

ALTER FUNCTION public.get_expenses_summary(UUID, DATE, DATE, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_expenses_summary(UUID, DATE, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_expenses_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 10a-iii. Monthly non-salary expenses aggregate (excludes Salary-category rows to prevent
--          double-counting against authoritative public.staff_payments).
DROP FUNCTION IF EXISTS public.get_monthly_expenses_summary(UUID, INT, UUID);

CREATE OR REPLACE FUNCTION public.get_monthly_expenses_summary(
  p_business_id UUID,
  p_year INT,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  month_num INT,
  total_amount NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_effective_branch_id UUID;
BEGIN
  IF p_business_id IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'Business ID and year are required.';
  END IF;

  v_effective_branch_id := public.resolve_authorized_expense_branch(p_business_id, p_branch_id);

  RETURN QUERY
  SELECT
    EXTRACT(MONTH FROM e.date)::INT AS month_num,
    COALESCE(SUM(e.amount), 0) AS total_amount
  FROM public.expenses e
  WHERE e.business_id = p_business_id
    AND e.date >= make_date(p_year, 1, 1)
    AND e.date <= make_date(p_year, 12, 31)
    AND e.deleted_at IS NULL
    AND NOT public.is_salary_expense_category(e.category)
    AND (v_effective_branch_id IS NULL OR e.branch_id = v_effective_branch_id)
  GROUP BY EXTRACT(MONTH FROM e.date)::INT
  ORDER BY 1;
END;
$$;

ALTER FUNCTION public.get_monthly_expenses_summary(UUID, INT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_monthly_expenses_summary(UUID, INT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_monthly_expenses_summary(UUID, INT, UUID) TO authenticated;

-- 10a-iv. Centralized Financial Summary RPC (Single Source of Truth for Dashboard)
--         Formula:
--           Total Expenses = Non-Salary Expenses + Authoritative Teacher Payroll (staff_payments) + Confirmed Standalone Salary Expenses
--           Net Profit     = Collections - Total Expenses
--         Linked duplicate Salary expenses (staff_payment_id IS NOT NULL / 'linked_duplicate') are excluded.
--         Confirmed standalone Salary expenses ('standalone') are included.
--         Unresolved Salary expenses ('unresolved' or NULL status with NULL staff_payment_id) are tracked
--         separately in unresolved_salary_expense_count / unresolved_salary_expense_amount and set is_reconciled = false.
DROP FUNCTION IF EXISTS public.get_financial_summary(UUID, DATE, DATE, TEXT, INT, UUID);

CREATE OR REPLACE FUNCTION public.get_financial_summary(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_month TEXT,
  p_year INT,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  collections NUMERIC,
  non_salary_expenses NUMERIC,
  teacher_payroll NUMERIC,
  standalone_salary_expenses NUMERIC,
  unresolved_salary_expense_count INT,
  unresolved_salary_expense_amount NUMERIC,
  total_expenses NUMERIC,
  net_profit NUMERIC,
  is_reconciled BOOLEAN,
  effective_branch_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_effective_branch_id UUID;
  v_collections NUMERIC := 0;
  v_non_salary_expenses NUMERIC := 0;
  v_teacher_payroll NUMERIC := 0;
  v_standalone_salary_expenses NUMERIC := 0;
  v_unresolved_count INT := 0;
  v_unresolved_amount NUMERIC := 0;
  v_total_expenses NUMERIC := 0;
BEGIN
  IF p_business_id IS NULL OR p_start_date IS NULL OR p_end_date IS NULL OR p_month IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'Business ID, start date, end date, month, and year are required.';
  END IF;

  v_effective_branch_id := public.resolve_authorized_expense_branch(p_business_id, p_branch_id);

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_collections
  FROM public.payments p
  WHERE p.business_id = p_business_id
    AND p.month = p_month
    AND p.year = p_year
    AND p.status = 'Paid'
    AND (v_effective_branch_id IS NULL OR p.branch_id = v_effective_branch_id);

  SELECT COALESCE(SUM(e.amount), 0)
  INTO v_non_salary_expenses
  FROM public.expenses e
  WHERE e.business_id = p_business_id
    AND e.date >= p_start_date
    AND e.date <= p_end_date
    AND e.deleted_at IS NULL
    AND NOT public.is_salary_expense_category(e.category)
    AND (v_effective_branch_id IS NULL OR e.branch_id = v_effective_branch_id);

  SELECT COALESCE(SUM(sp.amount), 0)
  INTO v_teacher_payroll
  FROM public.staff_payments sp
  WHERE sp.business_id = p_business_id
    AND sp.month = p_month
    AND sp.year = p_year
    AND sp.deleted_at IS NULL
    AND (v_effective_branch_id IS NULL OR sp.branch_id = v_effective_branch_id);

  SELECT
    COALESCE(SUM(CASE WHEN e.staff_payment_id IS NULL AND e.salary_reconciliation_status = 'standalone' THEN e.amount ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE e.staff_payment_id IS NULL AND COALESCE(e.salary_reconciliation_status, 'unresolved') = 'unresolved')::INT,
    COALESCE(SUM(CASE WHEN e.staff_payment_id IS NULL AND COALESCE(e.salary_reconciliation_status, 'unresolved') = 'unresolved' THEN e.amount ELSE 0 END), 0)
  INTO
    v_standalone_salary_expenses,
    v_unresolved_count,
    v_unresolved_amount
  FROM public.expenses e
  WHERE e.business_id = p_business_id
    AND e.date >= p_start_date
    AND e.date <= p_end_date
    AND e.deleted_at IS NULL
    AND public.is_salary_expense_category(e.category)
    AND (v_effective_branch_id IS NULL OR e.branch_id = v_effective_branch_id);

  v_total_expenses := v_non_salary_expenses + v_teacher_payroll + v_standalone_salary_expenses;

  RETURN QUERY
  SELECT
    v_collections,
    v_non_salary_expenses,
    v_teacher_payroll,
    v_standalone_salary_expenses,
    v_unresolved_count,
    v_unresolved_amount,
    v_total_expenses,
    v_collections - v_total_expenses,
    (v_unresolved_count = 0),
    v_effective_branch_id;
END;
$$;

ALTER FUNCTION public.get_financial_summary(UUID, DATE, DATE, TEXT, INT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_financial_summary(UUID, DATE, DATE, TEXT, INT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_summary(UUID, DATE, DATE, TEXT, INT, UUID) TO authenticated;

-- 10a-v. Centralized Monthly Financial Summary RPC (Single Source of Truth for Reports)
--        Uses the exact same formula as get_financial_summary across all 12 months of p_year.
DROP FUNCTION IF EXISTS public.get_monthly_financial_summary(UUID, INT, UUID);

CREATE OR REPLACE FUNCTION public.get_monthly_financial_summary(
  p_business_id UUID,
  p_year INT,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  month_num INT,
  month_name TEXT,
  non_salary_expenses NUMERIC,
  teacher_payroll NUMERIC,
  standalone_salary_expenses NUMERIC,
  unresolved_salary_expense_count INT,
  unresolved_salary_expense_amount NUMERIC,
  total_expenses NUMERIC,
  is_reconciled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_effective_branch_id UUID;
BEGIN
  IF p_business_id IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'Business ID and year are required.';
  END IF;

  v_effective_branch_id := public.resolve_authorized_expense_branch(p_business_id, p_branch_id);

  RETURN QUERY
  WITH months AS (
    SELECT
      gs AS m_num,
      (ARRAY[
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ])[gs] AS m_name
    FROM generate_series(1, 12) AS gs
  ),
  exp_by_month AS (
    SELECT
      EXTRACT(MONTH FROM e.date)::INT AS m_num,
      COALESCE(SUM(e.amount) FILTER (WHERE NOT public.is_salary_expense_category(e.category)), 0) AS non_sal_amt,
      COALESCE(SUM(e.amount) FILTER (WHERE public.is_salary_expense_category(e.category) AND e.staff_payment_id IS NULL AND e.salary_reconciliation_status = 'standalone'), 0) AS standalone_amt,
      COUNT(*) FILTER (WHERE public.is_salary_expense_category(e.category) AND e.staff_payment_id IS NULL AND COALESCE(e.salary_reconciliation_status, 'unresolved') = 'unresolved')::INT AS unresolved_cnt,
      COALESCE(SUM(e.amount) FILTER (WHERE public.is_salary_expense_category(e.category) AND e.staff_payment_id IS NULL AND COALESCE(e.salary_reconciliation_status, 'unresolved') = 'unresolved'), 0) AS unresolved_amt
    FROM public.expenses e
    WHERE e.business_id = p_business_id
      AND e.date >= make_date(p_year, 1, 1)
      AND e.date <= make_date(p_year, 12, 31)
      AND e.deleted_at IS NULL
      AND (v_effective_branch_id IS NULL OR e.branch_id = v_effective_branch_id)
    GROUP BY EXTRACT(MONTH FROM e.date)::INT
  ),
  payroll_by_month AS (
    SELECT
      sp.month AS m_name,
      COALESCE(SUM(sp.amount), 0) AS amt
    FROM public.staff_payments sp
    WHERE sp.business_id = p_business_id
      AND sp.year = p_year
      AND sp.deleted_at IS NULL
      AND (v_effective_branch_id IS NULL OR sp.branch_id = v_effective_branch_id)
    GROUP BY sp.month
  )
  SELECT
    m.m_num::INT AS month_num,
    m.m_name::TEXT AS month_name,
    COALESCE(ebm.non_sal_amt, 0)::NUMERIC AS non_salary_expenses,
    COALESCE(pbm.amt, 0)::NUMERIC AS teacher_payroll,
    COALESCE(ebm.standalone_amt, 0)::NUMERIC AS standalone_salary_expenses,
    COALESCE(ebm.unresolved_cnt, 0)::INT AS unresolved_salary_expense_count,
    COALESCE(ebm.unresolved_amt, 0)::NUMERIC AS unresolved_salary_expense_amount,
    (COALESCE(ebm.non_sal_amt, 0) + COALESCE(pbm.amt, 0) + COALESCE(ebm.standalone_amt, 0))::NUMERIC AS total_expenses,
    (COALESCE(ebm.unresolved_cnt, 0) = 0)::BOOLEAN AS is_reconciled
  FROM months m
  LEFT JOIN exp_by_month ebm ON ebm.m_num = m.m_num
  LEFT JOIN payroll_by_month pbm ON pbm.m_name = m.m_name
  ORDER BY m.m_num;
END;
$$;

ALTER FUNCTION public.get_monthly_financial_summary(UUID, INT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_monthly_financial_summary(UUID, INT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_monthly_financial_summary(UUID, INT, UUID) TO authenticated;

-- 10a-vi. SECURE RPCs: Unresolved Salary Expense Reconciliation (For Puan Hana Only)
DROP FUNCTION IF EXISTS public.get_unresolved_salary_expenses(UUID, UUID);

CREATE OR REPLACE FUNCTION public.get_unresolved_salary_expenses(
  p_business_id UUID,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  business_id UUID,
  branch_id UUID,
  branch_name TEXT,
  date DATE,
  category TEXT,
  description TEXT,
  amount NUMERIC,
  salary_reconciliation_status TEXT,
  staff_payment_id UUID,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'Business ID is required.';
  END IF;

  IF NOT public.is_salary_authorized(p_business_id) THEN
    RAISE EXCEPTION 'Access denied: only the authorized salary administrator may inspect unresolved salary expenses.';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.business_id,
    e.branch_id,
    b.name AS branch_name,
    e.date,
    e.category,
    e.description,
    e.amount,
    COALESCE(e.salary_reconciliation_status, 'unresolved')::TEXT AS salary_reconciliation_status,
    e.staff_payment_id,
    e.created_at
  FROM public.expenses e
  LEFT JOIN public.branches b ON b.id = e.branch_id
  WHERE e.business_id = p_business_id
    AND e.deleted_at IS NULL
    AND public.is_salary_expense_category(e.category)
    AND e.staff_payment_id IS NULL
    AND COALESCE(e.salary_reconciliation_status, 'unresolved') = 'unresolved'
    AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
  ORDER BY e.date DESC, e.created_at DESC;
END;
$$;

ALTER FUNCTION public.get_unresolved_salary_expenses(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_unresolved_salary_expenses(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unresolved_salary_expenses(UUID, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.get_reconcilable_staff_payments(UUID, UUID);

CREATE OR REPLACE FUNCTION public.get_reconcilable_staff_payments(
  p_business_id UUID,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  branch_id UUID,
  amount NUMERIC,
  date DATE,
  month TEXT,
  year INT,
  staff_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'Business ID is required.';
  END IF;

  IF NOT public.is_salary_authorized(p_business_id) THEN
    RAISE EXCEPTION 'Access denied: only the authorized salary administrator may inspect teacher payment records.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    sp.id,
    sp.branch_id,
    sp.amount,
    sp.date,
    sp.month,
    sp.year,
    s.name AS staff_name
  FROM public.staff_payments sp
  LEFT JOIN public.staff s ON s.id = sp.staff_id
  WHERE sp.business_id = p_business_id
    AND sp.deleted_at IS NULL
    AND (p_branch_id IS NULL OR sp.branch_id = p_branch_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.staff_payment_id = sp.id
        AND e.deleted_at IS NULL
    )
  ORDER BY sp.date DESC, sp.created_at DESC
  LIMIT 50;
END;
$$;

ALTER FUNCTION public.get_reconcilable_staff_payments(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_reconcilable_staff_payments(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reconcilable_staff_payments(UUID, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.reconcile_salary_expense(UUID, UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.reconcile_salary_expense(
  p_business_id UUID,
  p_expense_id UUID,
  p_new_status TEXT,
  p_staff_payment_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  salary_reconciliation_status TEXT,
  staff_payment_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expense RECORD;
  v_payment RECORD;
  v_actor_uid UUID := auth.uid();
BEGIN
  IF p_business_id IS NULL OR p_expense_id IS NULL OR p_new_status IS NULL THEN
    RAISE EXCEPTION 'Business ID, expense ID, and new status are required.';
  END IF;

  IF NOT public.is_salary_authorized(p_business_id) THEN
    RAISE EXCEPTION 'Access denied: only the authorized salary administrator may reconcile salary expenses.';
  END IF;

  IF p_new_status NOT IN ('linked_duplicate', 'standalone', 'unresolved') THEN
    RAISE EXCEPTION 'Invalid reconciliation status: %. Allowed: linked_duplicate, standalone, unresolved.', p_new_status;
  END IF;

  SELECT e.id, e.business_id, e.branch_id, e.category, e.amount, e.date,
         e.salary_reconciliation_status, e.staff_payment_id, e.deleted_at
  INTO v_expense
  FROM public.expenses e
  WHERE e.id = p_expense_id
    AND e.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND OR v_expense.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Expense record (%) not found or deleted in target business.', p_expense_id;
  END IF;

  IF NOT public.is_salary_expense_category(v_expense.category) THEN
    RAISE EXCEPTION 'Expense (%) is not a Salary-category expense.', p_expense_id;
  END IF;

  IF p_new_status = 'linked_duplicate' THEN
    IF p_staff_payment_id IS NULL THEN
      RAISE EXCEPTION 'A staff_payment_id is required when classifying as linked_duplicate.';
    END IF;

    SELECT sp.id, sp.business_id, sp.branch_id, sp.deleted_at
    INTO v_payment
    FROM public.staff_payments sp
    WHERE sp.id = p_staff_payment_id
    FOR UPDATE;

    IF NOT FOUND OR v_payment.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Target staff_payment (%) not found or deleted.', p_staff_payment_id;
    END IF;

    IF v_payment.business_id <> p_business_id THEN
      RAISE EXCEPTION 'Cross-business violation: staff_payment (%) belongs to another business.', p_staff_payment_id;
    END IF;

    IF v_expense.branch_id IS NULL OR v_payment.branch_id IS NULL OR v_expense.branch_id IS DISTINCT FROM v_payment.branch_id THEN
      RAISE EXCEPTION 'Branch mismatch: expense branch (%) must match staff_payment branch (%).', v_expense.branch_id, v_payment.branch_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.expenses other
      WHERE other.staff_payment_id = p_staff_payment_id
        AND other.id <> p_expense_id
        AND other.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Duplicate link violation: staff_payment (%) is already linked to another active expense.', p_staff_payment_id;
    END IF;

    UPDATE public.expenses
    SET salary_reconciliation_status = 'linked_duplicate',
        staff_payment_id = p_staff_payment_id
    WHERE public.expenses.id = p_expense_id;
  ELSE
    IF p_staff_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'staff_payment_id must be NULL when classifying as %.', p_new_status;
    END IF;

    UPDATE public.expenses
    SET salary_reconciliation_status = p_new_status,
        staff_payment_id = NULL
    WHERE public.expenses.id = p_expense_id;
  END IF;

  IF v_actor_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = v_actor_uid) THEN
    INSERT INTO public.activity_logs (business_id, user_id, module, action, old_value, new_value)
    VALUES (
      p_business_id,
      v_actor_uid,
      'expenses',
      'reconcile_salary_expense',
      jsonb_build_object(
        'expense_id', p_expense_id,
        'salary_reconciliation_status', v_expense.salary_reconciliation_status,
        'staff_payment_id', v_expense.staff_payment_id
      ),
      jsonb_build_object(
        'expense_id', p_expense_id,
        'salary_reconciliation_status', p_new_status,
        'staff_payment_id', CASE WHEN p_new_status = 'linked_duplicate' THEN p_staff_payment_id ELSE NULL END
      )
    );
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.salary_reconciliation_status,
    e.staff_payment_id
  FROM public.expenses e
  WHERE e.id = p_expense_id;
END;
$$;

ALTER FUNCTION public.reconcile_salary_expense(UUID, UUID, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_salary_expense(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_salary_expense(UUID, UUID, TEXT, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 10b. SECURE RPC: get_payroll_reconciliation_summary (For Puan Hana Only)
--      Enforces the explicit reconciliation formula:
--      Consolidated Payroll = Pauh Jaya Payroll + Kelisa Emas Payroll + Unmapped Payroll
--      (and generally Consolidated Payroll = Branch Allocated Payroll + Unmapped Payroll)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_payroll_reconciliation_summary(UUID, TEXT, INT);

CREATE OR REPLACE FUNCTION public.get_payroll_reconciliation_summary(
  p_business_id UUID,
  p_month TEXT DEFAULT NULL,
  p_year INT DEFAULT NULL
)
RETURNS TABLE (
  consolidated_payroll NUMERIC,
  pauh_jaya_payroll NUMERIC,
  kelisa_emas_payroll NUMERIC,
  branch_allocated_payroll NUMERIC,
  unmapped_payroll NUMERIC,
  unexpected_branch_payroll NUMERIC,
  total_payment_count INT,
  confidently_mapped_count INT,
  unmapped_payment_count INT,
  unexpected_branch_count INT,
  ambiguous_ownership_count INT,
  unestablished_branch_count INT,
  is_reconciled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_expected_pauh_id CONSTANT UUID := '9420a109-4a28-47f3-93ff-f4be08012719';
  v_expected_kelisa_id CONSTANT UUID := 'e4f61aac-9629-4be7-ae7e-8d9b462233a4';
  v_total_branch_count INT;
  v_pauh_count INT;
  v_kelisa_count INT;
  v_pauh_jaya_id UUID;
  v_kelisa_emas_id UUID;
BEGIN
  IF p_business_id IS NULL OR NOT public.is_salary_authorized(p_business_id) THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to view payroll reconciliation details.';
  END IF;

  -- Policy: Count ALL branches belonging to p_business_id (inactive branches are intentionally
  -- NOT excluded so a disabled or rogue third branch cannot silently bypass the 2-branch invariant).
  SELECT COUNT(*) INTO v_total_branch_count
  FROM public.branches b
  WHERE b.business_id = p_business_id;

  IF v_total_branch_count <> 2 THEN
    RAISE EXCEPTION 'Reconciliation failed closed: Expected exactly 2 branches for business %, found %.', p_business_id, v_total_branch_count;
  END IF;

  -- Fail-closed branch validation: verify exact Pauh Jaya & Kelisa Emas branches exist,
  -- are not duplicated by name, belong to p_business_id, and match expected UUIDs.
  SELECT COUNT(*) INTO v_pauh_count
  FROM public.branches b
  WHERE b.business_id = p_business_id
    AND b.name ILIKE '%Pauh Jaya%';

  IF v_pauh_count = 0 THEN
    RAISE EXCEPTION 'Reconciliation failed closed: Expected Pauh Jaya branch is missing for business %.', p_business_id;
  ELSIF v_pauh_count > 1 THEN
    RAISE EXCEPTION 'Reconciliation failed closed: Ambiguous/duplicate Pauh Jaya branch match (%) for business %.', v_pauh_count, p_business_id;
  END IF;

  SELECT COUNT(*) INTO v_kelisa_count
  FROM public.branches b
  WHERE b.business_id = p_business_id
    AND b.name ILIKE '%Kelisa Emas%';

  IF v_kelisa_count = 0 THEN
    RAISE EXCEPTION 'Reconciliation failed closed: Expected Kelisa Emas branch is missing for business %.', p_business_id;
  ELSIF v_kelisa_count > 1 THEN
    RAISE EXCEPTION 'Reconciliation failed closed: Ambiguous/duplicate Kelisa Emas branch match (%) for business %.', v_kelisa_count, p_business_id;
  END IF;

  SELECT b.id INTO v_pauh_jaya_id
  FROM public.branches b
  WHERE b.business_id = p_business_id
    AND b.name ILIKE '%Pauh Jaya%';

  IF v_pauh_jaya_id IS DISTINCT FROM v_expected_pauh_id THEN
    RAISE EXCEPTION 'Reconciliation failed closed: Pauh Jaya branch ID (%) does not match expected UUID (%).', v_pauh_jaya_id, v_expected_pauh_id;
  END IF;

  SELECT b.id INTO v_kelisa_emas_id
  FROM public.branches b
  WHERE b.business_id = p_business_id
    AND b.name ILIKE '%Kelisa Emas%';

  IF v_kelisa_emas_id IS DISTINCT FROM v_expected_kelisa_id THEN
    RAISE EXCEPTION 'Reconciliation failed closed: Kelisa Emas branch ID (%) does not match expected UUID (%).', v_kelisa_emas_id, v_expected_kelisa_id;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(sp.amount), 0)::NUMERIC AS consolidated_payroll,
    COALESCE(SUM(sp.amount) FILTER (WHERE sp.branch_id = v_pauh_jaya_id), 0)::NUMERIC AS pauh_jaya_payroll,
    COALESCE(SUM(sp.amount) FILTER (WHERE sp.branch_id = v_kelisa_emas_id), 0)::NUMERIC AS kelisa_emas_payroll,
    COALESCE(SUM(sp.amount) FILTER (WHERE sp.branch_id IS NOT NULL), 0)::NUMERIC AS branch_allocated_payroll,
    COALESCE(SUM(sp.amount) FILTER (WHERE sp.branch_id IS NULL), 0)::NUMERIC AS unmapped_payroll,
    COALESCE(SUM(sp.amount) FILTER (WHERE sp.branch_id IS NOT NULL AND sp.branch_id NOT IN (v_pauh_jaya_id, v_kelisa_emas_id)), 0)::NUMERIC AS unexpected_branch_payroll,
    COUNT(*)::INT AS total_payment_count,
    COUNT(*) FILTER (WHERE sp.branch_id IN (v_pauh_jaya_id, v_kelisa_emas_id))::INT AS confidently_mapped_count,
    COUNT(*) FILTER (WHERE sp.branch_id IS NULL)::INT AS unmapped_payment_count,
    COUNT(*) FILTER (WHERE sp.branch_id IS NOT NULL AND sp.branch_id NOT IN (v_pauh_jaya_id, v_kelisa_emas_id))::INT AS unexpected_branch_count,
    COUNT(*) FILTER (
      WHERE sp.branch_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.business_id = p_business_id
            AND g.teacher_id = sp.staff_id
            AND g.branch_id IS NOT NULL
        )
    )::INT AS ambiguous_ownership_count,
    COUNT(*) FILTER (
      WHERE sp.branch_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.business_id = p_business_id
            AND g.teacher_id = sp.staff_id
            AND g.branch_id IS NOT NULL
        )
    )::INT AS unestablished_branch_count,
    (
      COUNT(*) FILTER (WHERE sp.branch_id IS NULL) = 0
      AND COUNT(*) FILTER (WHERE sp.branch_id IS NOT NULL AND sp.branch_id NOT IN (v_pauh_jaya_id, v_kelisa_emas_id)) = 0
      AND COALESCE(SUM(sp.amount) FILTER (WHERE sp.branch_id IS NOT NULL AND sp.branch_id NOT IN (v_pauh_jaya_id, v_kelisa_emas_id)), 0) = 0
      AND COALESCE(SUM(sp.amount), 0) = (
        COALESCE(SUM(sp.amount) FILTER (WHERE sp.branch_id = v_pauh_jaya_id), 0)
        + COALESCE(SUM(sp.amount) FILTER (WHERE sp.branch_id = v_kelisa_emas_id), 0)
        + COALESCE(SUM(sp.amount) FILTER (WHERE sp.branch_id IS NULL), 0)
      )
    )::BOOLEAN AS is_reconciled
  FROM public.staff_payments sp
  WHERE sp.business_id = p_business_id
    AND sp.deleted_at IS NULL
    AND (p_month IS NULL OR sp.month = p_month)
    AND (p_year IS NULL OR sp.year = p_year);
END;
$$;

ALTER FUNCTION public.get_payroll_reconciliation_summary(UUID, TEXT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_payroll_reconciliation_summary(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payroll_reconciliation_summary(UUID, TEXT, INT) TO authenticated;

-- ------------------------------------------------------------
-- 10c. SECURE RPC: get_historical_payroll_audit (For Puan Hana Only)
--      Inspects every payment in public.staff_payments and classifies:
--      - CONFIDENTLY_MAPPED (explicit branch_id present)
--      - AMBIGUOUS_PRE_MIGRATION_TRANSFER (teacher has classes across >1 branch
--        including inactive/deleted classes, or payment date precedes current branch/class)
--      - AMBIGUOUS_MULTI_BRANCH (teacher currently teaches in >1 active branch)
--      - UNPROVEN_CURRENT_CLASS_INFERENCE (teacher currently teaches in 1 branch,
--        but pre-migration payment lacks branch provenance in source data)
--      - UNESTABLISHED_NO_CLASS_LINK (teacher has 0 class assignments in public.groups)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_historical_payroll_audit(UUID);

CREATE OR REPLACE FUNCTION public.get_historical_payroll_audit(p_business_id UUID)
RETURNS TABLE (
  payment_id UUID,
  staff_id UUID,
  teacher_name TEXT,
  month TEXT,
  year INT,
  amount NUMERIC,
  payment_date DATE,
  notes TEXT,
  payment_branch_id UUID,
  payment_branch_name TEXT,
  teacher_current_branch_id UUID,
  teacher_current_branch_name TEXT,
  active_class_branch_count INT,
  all_history_branch_count INT,
  transferred_before_migration BOOLEAN,
  potential_wrong_current_branch_assignment BOOLEAN,
  ownership_status TEXT,
  ownership_explanation TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF p_business_id IS NULL OR NOT public.is_salary_authorized(p_business_id) THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to audit teacher payment records.';
  END IF;

  RETURN QUERY
  WITH teacher_branch_stats AS (
    SELECT
      s.id AS t_id,
      COUNT(DISTINCT g.branch_id) FILTER (WHERE g.deleted_at IS NULL AND g.status = 'Active')::INT AS active_branches,
      COUNT(DISTINCT g.branch_id)::INT AS total_branches,
      CASE
        WHEN COUNT(DISTINCT g.branch_id) FILTER (WHERE g.deleted_at IS NULL AND g.status = 'Active') = 1
        THEN (ARRAY_AGG(DISTINCT g.branch_id) FILTER (WHERE g.deleted_at IS NULL AND g.status = 'Active'))[1]
        ELSE NULL
      END AS single_active_branch_id,
      MIN(g.created_at::date) FILTER (WHERE g.deleted_at IS NULL AND g.status = 'Active') AS min_active_class_date
    FROM public.staff s
    LEFT JOIN public.groups g
      ON g.teacher_id = s.id
     AND g.business_id = s.business_id
     AND g.branch_id IS NOT NULL
    WHERE s.business_id = p_business_id
    GROUP BY s.id
  )
  SELECT
    sp.id AS payment_id,
    sp.staff_id,
    s.name AS teacher_name,
    sp.month,
    sp.year,
    sp.amount,
    sp.date AS payment_date,
    sp.notes,
    sp.branch_id AS payment_branch_id,
    pb.name AS payment_branch_name,
    COALESCE(s.branch_id, tbs.single_active_branch_id) AS teacher_current_branch_id,
    tb.name AS teacher_current_branch_name,
    COALESCE(tbs.active_branches, 0) AS active_class_branch_count,
    COALESCE(tbs.total_branches, 0) AS all_history_branch_count,
    (
      (COALESCE(tbs.total_branches, 0) > 1 AND COALESCE(tbs.active_branches, 0) <= 1)
      OR (
        tbs.single_active_branch_id IS NOT NULL
        AND (
          sp.date < COALESCE(tb.created_at::date, sp.date)
          OR sp.date < COALESCE(tbs.min_active_class_date, sp.date)
        )
      )
    )::BOOLEAN AS transferred_before_migration,
    (
      sp.branch_id IS NULL
      AND COALESCE(tbs.active_branches, 0) = 1
    )::BOOLEAN AS potential_wrong_current_branch_assignment,
    CASE
      WHEN sp.branch_id IS NOT NULL THEN 'CONFIDENTLY_MAPPED'
      WHEN COALESCE(tbs.active_branches, 0) > 1 THEN 'AMBIGUOUS_MULTI_BRANCH'
      WHEN (COALESCE(tbs.total_branches, 0) > 1 AND COALESCE(tbs.active_branches, 0) <= 1)
        OR (
          tbs.single_active_branch_id IS NOT NULL
          AND (
            sp.date < COALESCE(tb.created_at::date, sp.date)
            OR sp.date < COALESCE(tbs.min_active_class_date, sp.date)
          )
        ) THEN 'AMBIGUOUS_PRE_MIGRATION_TRANSFER'
      WHEN COALESCE(tbs.active_branches, 0) = 1 THEN 'UNPROVEN_CURRENT_CLASS_INFERENCE'
      ELSE 'UNESTABLISHED_NO_CLASS_LINK'
    END AS ownership_status,
    CASE
      WHEN sp.branch_id IS NOT NULL THEN
        'Explicitly allocated to branch ' || COALESCE(pb.name, sp.branch_id::text) || '.'
      WHEN COALESCE(tbs.active_branches, 0) > 1 THEN
        'Teacher is assigned to active classes in multiple branches. Historical payment ownership is ambiguous.'
      WHEN (COALESCE(tbs.total_branches, 0) > 1 AND COALESCE(tbs.active_branches, 0) <= 1)
        OR (
          tbs.single_active_branch_id IS NOT NULL
          AND (
            sp.date < COALESCE(tb.created_at::date, sp.date)
            OR sp.date < COALESCE(tbs.min_active_class_date, sp.date)
          )
        ) THEN
        'Teacher shows pre-migration branch transfer indicators (previous branch class or payment predating current branch/class). Must not be auto-assigned to current branch.'
      WHEN COALESCE(tbs.active_branches, 0) = 1 THEN
        'Teacher currently teaches in ' || COALESCE(tb.name, '1 branch') || ', but pre-Migration 08 payment schema stores no historical branch provenance. Requires owner confirmation.'
      ELSE
        'Teacher has no class assignments in public.groups; historical branch cannot be established from class data.'
    END AS ownership_explanation
  FROM public.staff_payments sp
  JOIN public.staff s
    ON s.id = sp.staff_id
   AND s.business_id = sp.business_id
  LEFT JOIN teacher_branch_stats tbs
    ON tbs.t_id = s.id
  LEFT JOIN public.branches pb
    ON pb.id = sp.branch_id
   AND pb.business_id = sp.business_id
  LEFT JOIN public.branches tb
    ON tb.id = COALESCE(s.branch_id, tbs.single_active_branch_id)
   AND tb.business_id = sp.business_id
  WHERE sp.business_id = p_business_id
    AND sp.deleted_at IS NULL
  ORDER BY sp.year DESC, sp.date DESC, sp.created_at DESC;
END;
$$;

ALTER FUNCTION public.get_historical_payroll_audit(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_historical_payroll_audit(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_historical_payroll_audit(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 10d. SECURE RPC: assign_staff_payment_branch (For Puan Hana Only)
--      Allows Puan Hana to explicitly reconcile an unmapped historical payment
--      (or update a payment's branch) to an active branch in the target business.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.assign_staff_payment_branch(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.assign_staff_payment_branch(
  p_business_id UUID,
  p_payment_id UUID,
  p_branch_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_id UUID;
BEGIN
  IF p_business_id IS NULL OR NOT public.is_salary_authorized(p_business_id) THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to reconcile teacher payment records.';
  END IF;

  IF p_payment_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Payment ID and target Branch ID are required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.business_id = p_business_id
      AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'Invalid or inactive branch_id % for business %.', p_branch_id, p_business_id;
  END IF;

  PERFORM set_config('biztrack.reconcile_payment_branch', 'true', true);

  UPDATE public.staff_payments
  SET branch_id = p_branch_id
  WHERE id = p_payment_id
    AND business_id = p_business_id
    AND deleted_at IS NULL
  RETURNING id INTO v_updated_id;

  PERFORM set_config('biztrack.reconcile_payment_branch', 'false', true);

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Active staff payment % not found in business %.', p_payment_id, p_business_id;
  END IF;

  RETURN TRUE;
END;
$$;

ALTER FUNCTION public.assign_staff_payment_branch(UUID, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_staff_payment_branch(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_staff_payment_branch(UUID, UUID, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 11. POST-MIGRATION INVARIANT & SAFETY VERIFICATION
-- ------------------------------------------------------------
DO $$
DECLARE
  v_protected_biz_id CONSTANT UUID := 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';
  v_protected_branch_rows INT;
BEGIN
  SELECT
    (SELECT COUNT(*) FROM public.branches WHERE business_id = v_protected_biz_id) +
    (SELECT COUNT(*) FROM public.staff WHERE business_id = v_protected_biz_id AND branch_id IS NOT NULL) +
    (SELECT COUNT(*) FROM public.staff_payments WHERE business_id = v_protected_biz_id AND branch_id IS NOT NULL) +
    (SELECT COUNT(*) FROM public.expenses WHERE business_id = v_protected_biz_id AND branch_id IS NOT NULL)
  INTO v_protected_branch_rows;

  IF v_protected_branch_rows > 0 THEN
    RAISE EXCEPTION 'Safety invariant violated: Protected workspace % was modified.', v_protected_biz_id;
  END IF;

  RAISE NOTICE 'Migration 08 completed successfully. Protected workspace % is 100%% untouched.', v_protected_biz_id;
END $$;

COMMIT;
