-- ============================================================
-- BIZTRACK MIGRATION 07: MULTI-BRANCH MANAGEMENT (HARDENED - PHASE 1Q)
-- ============================================================
-- Confirmed Production Target: PUSAT TUISYEN AKADEMIK MEGA (UUID: 978d2b0c-6a2b-4c28-9000-71dc23f96781)
-- Confirmed Target Owner: NORHANA ABDUL RANI (akademikmega.admin@gmail.com, Auth UID: d2b660bf-10d3-4d94-94ec-0b8f6e0908e6)
-- Protected Workspace (DO NOT MODIFY): Akademik Mega (UUID: ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad)
-- Target Branches: Pauh Jaya (Main/Default) & Kelisa Emas
-- Scope: Basic Multi-Branch Management (RM350 Package)
-- NOTE: DO NOT EXECUTE AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.
--
-- Security & Data Integrity Hardening (Phase 1N):
-- 1. Downgrade-Proof Multi-Branch Detection & Inactive Branch Enforcement:
--    - Multi-branch status is determined by the existence of ANY branch row in public.branches
--      for the business (regardless of is_active), preventing a security downgrade to
--      single-tenant mode if one or all branches are deactivated.
--    - Staff remain strictly restricted to their assigned branch even if one or all branches
--      are inactive; unassigned Staff remain fail-closed (0 access).
--    - NULL branch_id is never permitted in a configured multi-branch business.
--    - Operational writes (INSERT/UPDATE/DELETE) targeting inactive branches are blocked fail-closed.
--    - Single-tenant businesses with zero rows in public.branches remain 100% backward-compatible.
--    - business_id is strictly IMMUTABLE on UPDATE across customers, groups, payments, and business_users.
--    - Historical payment branch attribution preserved: Staff cannot alter payments.branch_id.
--    - Normal payment updates (e.g. invoice_path, notes, status) remain fully functional.
-- 2. Hardened Storage DELETE Isolation:
--    - Updates storage.objects DELETE policy to validate corresponding payment row in public.payments.
--    - Staff cannot delete invoice files belonging to another branch even if storage path is known.
--    - Legitimate invoice deletion within permitted branch preserved.
-- 3. Explicit SECURITY DEFINER Ownership & Path Pinning:
--    - All functions explicitly set OWNER TO postgres.
--    - search_path pinned strictly to 'public, pg_temp'.
--    - Execution granted strictly to authenticated roles.
-- 4. Immutable Membership Protection Trigger:
--    - Prevents alteration of user_id, business_id, or id on public.business_users.
--    - Staff cannot update business_users (fail-closed via RLS).
-- 5. Cross-Branch & Cross-Business Student-Class Validation:
--    - Trigger validates student and class belong to the same business and branch.
-- 6. Bulletproof Idempotency & Composite Constraints:
--    - Constraint checks scoped by both conname and conrelid = 'public.<table>'::regclass.
--    - Composite foreign keys (branch_id, business_id) enforce tenant integrity.
-- 7. Fail-Closed RLS Policies:
--    - Legacy permissive policies dropped on customers and groups to prevent OR-bypass.
--    - Branches SELECT restricted: Creator/Admin see all; Staff see ONLY their assigned branch.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. VERIFY TARGET BUSINESS & ACCOUNT-TO-WORKSPACE RELATIONSHIP
--    - Strictly targets 978d2b0c-6a2b-4c28-9000-71dc23f96781
--    - Verifies Creator association for d2b660bf-10d3-4d94-94ec-0b8f6e0908e6
--    - Explicitly excludes protected workspace ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad
-- ------------------------------------------------------------
DO $$
DECLARE
  v_target_biz_id CONSTANT UUID := '978d2b0c-6a2b-4c28-9000-71dc23f96781';
  v_target_owner_uid CONSTANT UUID := 'd2b660bf-10d3-4d94-94ec-0b8f6e0908e6';
  v_protected_biz_id CONSTANT UUID := 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';
  v_biz_count INT;
  v_biz_name TEXT;
  v_creator_count INT;
  v_owner_role TEXT;
BEGIN
  IF v_target_biz_id = v_protected_biz_id THEN
    RAISE EXCEPTION 'Migration aborted: Target business UUID matches protected workspace UUID %',
      v_protected_biz_id;
  END IF;

  SELECT COUNT(*), MAX(name)
  INTO v_biz_count, v_biz_name
  FROM public.businesses
  WHERE id = v_target_biz_id;

  IF v_biz_count <> 1 THEN
    RAISE EXCEPTION 'Migration aborted: Expected exactly 1 business for UUID %, found %',
      v_target_biz_id, v_biz_count;
  END IF;

  IF v_biz_name <> 'PUSAT TUISYEN AKADEMIK MEGA' THEN
    RAISE EXCEPTION 'Migration aborted: Business UUID % has unexpected name "%" (expected exact "PUSAT TUISYEN AKADEMIK MEGA")',
      v_target_biz_id, v_biz_name;
  END IF;

  SELECT COUNT(*)
  INTO v_creator_count
  FROM public.business_users bu
  WHERE bu.business_id = v_target_biz_id
    AND bu.role = 'Creator';

  IF v_creator_count <> 1 THEN
    RAISE EXCEPTION 'Migration aborted: Expected exactly 1 Creator for target business %, found %',
      v_target_biz_id, v_creator_count;
  END IF;

  SELECT bu.role
  INTO v_owner_role
  FROM public.business_users bu
  WHERE bu.business_id = v_target_biz_id
    AND bu.user_id = v_target_owner_uid;

  IF v_owner_role IS NULL OR v_owner_role <> 'Creator' THEN
    RAISE EXCEPTION 'Migration aborted: Confirmed owner UID % is not registered as Creator for target business % (found role: %)',
      v_target_owner_uid, v_target_biz_id, COALESCE(v_owner_role, 'NONE');
  END IF;

  RAISE NOTICE 'Target business verified: % (ID: %, Creator UID: %)',
    v_biz_name, v_target_biz_id, v_target_owner_uid;
END $$;

-- ------------------------------------------------------------
-- 2. CREATE public.branches TABLE & UNIQUE CONSTRAINTS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'branches_business_name_unique'
      AND conrelid = 'public.branches'::regclass
  ) THEN
    ALTER TABLE public.branches
      ADD CONSTRAINT branches_business_name_unique UNIQUE (business_id, name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'branches_id_business_id_unique'
      AND conrelid = 'public.branches'::regclass
  ) THEN
    ALTER TABLE public.branches
      ADD CONSTRAINT branches_id_business_id_unique UNIQUE (id, business_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. ADD NULLABLE branch_id COLUMNS TO APPLICATION TABLES
-- ------------------------------------------------------------
ALTER TABLE public.business_users
  ADD COLUMN IF NOT EXISTS branch_id UUID;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS branch_id UUID;

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS branch_id UUID;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS branch_id UUID;

-- ------------------------------------------------------------
-- 4. ENFORCE BRANCH-BUSINESS OWNERSHIP VIA COMPOSITE FOREIGN KEYS
--    Scoped by both conname and conrelid.
--    Uses ON DELETE RESTRICT to prevent branch deletion from corrupting
--    or nulling out business_id on existing membership or operational data.
-- ------------------------------------------------------------
DO $$
BEGIN
  -- Drop legacy single-column FKs if present
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'business_users_branch_id_fkey'
      AND conrelid = 'public.business_users'::regclass
  ) THEN
    ALTER TABLE public.business_users DROP CONSTRAINT business_users_branch_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_branch_id_fkey'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers DROP CONSTRAINT customers_branch_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'groups_branch_id_fkey'
      AND conrelid = 'public.groups'::regclass
  ) THEN
    ALTER TABLE public.groups DROP CONSTRAINT groups_branch_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_branch_id_fkey'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_branch_id_fkey;
  END IF;

  -- Add composite foreign keys (branch_id, business_id)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'business_users_branch_business_fkey'
      AND conrelid = 'public.business_users'::regclass
  ) THEN
    ALTER TABLE public.business_users
      ADD CONSTRAINT business_users_branch_business_fkey
      FOREIGN KEY (branch_id, business_id)
      REFERENCES public.branches(id, business_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_branch_business_fkey'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_branch_business_fkey
      FOREIGN KEY (branch_id, business_id)
      REFERENCES public.branches(id, business_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'groups_branch_business_fkey'
      AND conrelid = 'public.groups'::regclass
  ) THEN
    ALTER TABLE public.groups
      ADD CONSTRAINT groups_branch_business_fkey
      FOREIGN KEY (branch_id, business_id)
      REFERENCES public.branches(id, business_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_branch_business_fkey'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_branch_business_fkey
      FOREIGN KEY (branch_id, business_id)
      REFERENCES public.branches(id, business_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4a. SECURITY DEFINER HELPER FUNCTION: is_business_admin
--     Defined before trigger functions and Section 8 Staff backfill
--     because protect_business_users_immutability() and
--     enforce_operational_branch_id() invoke public.is_business_admin(UUID).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_business_admin(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_users
    WHERE business_id = p_business_id
      AND user_id = auth.uid()
      AND role IN ('Creator', 'Admin')
  );
$$;

ALTER FUNCTION public.is_business_admin(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_business_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_business_admin(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 5. IMMUTABLE MEMBERSHIP PROTECTION TRIGGER (business_users)
--    Enforces that user_id, business_id, and id cannot be altered on UPDATE.
--    Resolves PostgreSQL RLS column-level limitation.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_business_users_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Security violation: user_id cannot be changed in business_users';
  END IF;

  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'Security violation: business_id cannot be changed in business_users';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Security violation: primary key id cannot be changed in business_users';
  END IF;

  -- Defense-in-depth: even if a legacy permissive RLS policy existed, non-Admin authenticated
  -- users cannot modify role, branch_id, or any column on business_users.
  IF auth.uid() IS NOT NULL AND NOT public.is_business_admin(OLD.business_id) THEN
    RAISE EXCEPTION 'Security violation: only Creator or Admin can update business_users';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_business_users_immutability() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.protect_business_users_immutability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_business_users_immutability() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_business_users_immutability ON public.business_users;
CREATE TRIGGER trg_protect_business_users_immutability
  BEFORE UPDATE ON public.business_users
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_business_users_immutability();

-- ------------------------------------------------------------
-- 6. IMMUNE-TO-RLS STUDENT-CLASS GUARD TRIGGER
--    Validates student and class business_id and branch_id alignment.
--    Runs as SECURITY DEFINER with pinned search_path and postgres owner.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_student_class_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_biz_id UUID;
  v_group_branch_id UUID;
  v_has_branches BOOLEAN;
BEGIN
  -- 0. Guard business_id immutability on UPDATE first (deterministic ordering with trg_enforce_customer_branch)
  IF TG_OP = 'UPDATE' AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'Security violation: business_id is immutable for %', TG_TABLE_NAME;
  END IF;

  -- If assigned_group_id is NULL, student is not in any class -> valid
  IF NEW.assigned_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. Fetch group's business_id and branch_id using SECURITY DEFINER (immune to caller RLS)
  SELECT business_id, branch_id
  INTO v_group_biz_id, v_group_branch_id
  FROM public.groups
  WHERE id = NEW.assigned_group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid class assignment: Class % does not exist', NEW.assigned_group_id;
  END IF;

  -- 2. Validate Cross-Business: Class must belong to the exact same business
  IF v_group_biz_id <> NEW.business_id THEN
    RAISE EXCEPTION 'Cross-business assignment denied: Student business (%) does not match class business (%)',
      NEW.business_id, v_group_biz_id;
  END IF;

  -- 3. Check if business has ANY branch configuration (active or inactive).
  -- Branch isolation remains enabled even if all branches are deactivated.
  SELECT EXISTS (
    SELECT 1 FROM public.branches WHERE business_id = NEW.business_id
  ) INTO v_has_branches;

  -- 4. In a multi-branch business, validate Cross-Branch
  IF v_has_branches THEN
    IF NEW.branch_id IS NULL THEN
      RAISE EXCEPTION 'Invalid assignment: Student must be assigned to a branch in a multi-branch business before enrolling in a class';
    END IF;

    IF v_group_branch_id IS NULL THEN
      RAISE EXCEPTION 'Invalid class: Class % has no assigned branch in a multi-branch business', NEW.assigned_group_id;
    END IF;

    IF v_group_branch_id <> NEW.branch_id THEN
      RAISE EXCEPTION 'Cross-branch assignment denied: Student branch (%) does not match class branch (%)',
        NEW.branch_id, v_group_branch_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.check_student_class_branch() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_student_class_branch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_student_class_branch() TO authenticated;

DROP TRIGGER IF EXISTS trg_check_student_class_branch ON public.customers;
CREATE TRIGGER trg_check_student_class_branch
  BEFORE INSERT OR UPDATE OF branch_id, assigned_group_id, business_id
  ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.check_student_class_branch();

-- ------------------------------------------------------------
-- 7. SEED TARGET BRANCHES FOR CONFIRMED TARGET WORKSPACE
--    (Strictly restricted to 978d2b0c-6a2b-4c28-9000-71dc23f96781)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_target_biz_id CONSTANT UUID := '978d2b0c-6a2b-4c28-9000-71dc23f96781';
  v_protected_biz_id CONSTANT UUID := 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';
  v_pauh_jaya_id UUID;
  v_kelisa_emas_id UUID;
  v_cust_count INT := 0;
  v_group_count INT := 0;
  v_pay_count INT := 0;
  v_staff_count INT := 0;
  v_non_target_touched INT := 0;
BEGIN
  -- Insert or retrieve Pauh Jaya
  INSERT INTO public.branches (business_id, name, is_active)
  VALUES (v_target_biz_id, 'Pauh Jaya', true)
  ON CONFLICT (business_id, name) DO UPDATE SET is_active = true
  RETURNING id INTO v_pauh_jaya_id;

  -- Insert or retrieve Kelisa Emas
  INSERT INTO public.branches (business_id, name, is_active)
  VALUES (v_target_biz_id, 'Kelisa Emas', true)
  ON CONFLICT (business_id, name) DO UPDATE SET is_active = true
  RETURNING id INTO v_kelisa_emas_id;

  -- ------------------------------------------------------------
  -- 8. BACKFILL EXISTING RECORDS IN TARGET WORKSPACE TO PAUH JAYA
  --    (Strictly scoped to 978d2b0c-6a2b-4c28-9000-71dc23f96781 where branch_id IS NULL)
  -- ------------------------------------------------------------
  -- Backfill classes (groups) first so student trigger validation passes
  WITH updated_groups AS (
    UPDATE public.groups
    SET branch_id = v_pauh_jaya_id
    WHERE business_id = v_target_biz_id
      AND branch_id IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_group_count FROM updated_groups;

  -- Backfill students (customers)
  WITH updated_customers AS (
    UPDATE public.customers
    SET branch_id = v_pauh_jaya_id
    WHERE business_id = v_target_biz_id
      AND branch_id IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cust_count FROM updated_customers;

  -- Backfill payments
  WITH updated_payments AS (
    UPDATE public.payments
    SET branch_id = v_pauh_jaya_id
    WHERE business_id = v_target_biz_id
      AND branch_id IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_pay_count FROM updated_payments;

  -- Backfill existing Staff users in business_users for target workspace only
  WITH updated_staff AS (
    UPDATE public.business_users
    SET branch_id = v_pauh_jaya_id
    WHERE business_id = v_target_biz_id
      AND role = 'Staff'
      AND branch_id IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_staff_count FROM updated_staff;

  -- Post-backfill safety invariant: verify protected workspace (ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad)
  -- and all other non-target workspaces have zero branches and zero branch_id assignments
  SELECT
    (SELECT COUNT(*) FROM public.branches WHERE business_id <> v_target_biz_id) +
    (SELECT COUNT(*) FROM public.groups WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL) +
    (SELECT COUNT(*) FROM public.customers WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL) +
    (SELECT COUNT(*) FROM public.payments WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL) +
    (SELECT COUNT(*) FROM public.business_users WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL)
  INTO v_non_target_touched;

  IF v_non_target_touched > 0 THEN
    RAISE EXCEPTION 'Migration aborted: Non-target or protected workspace (including %) was modified (% rows)',
      v_protected_biz_id, v_non_target_touched;
  END IF;

  RAISE NOTICE 'Backfill complete for target business %: % classes, % students, % payments, % staff assigned to Pauh Jaya.',
    v_target_biz_id, v_group_count, v_cust_count, v_pay_count, v_staff_count;
END $$;

-- ------------------------------------------------------------
-- 9. DATABASE-LEVEL ENFORCEMENT: MANDATORY OPERATIONAL branch_id
--    & CROSS-BUSINESS RECORD PROTECTION
--    - In multi-branch businesses, customers, groups, payments cannot have branch_id = NULL.
--    - Single-tenant businesses remain unaffected (backward compatible).
--    - business_id is strictly immutable on UPDATE for customers, groups, and payments.
--    - Guards historical payment branch attribution: Staff cannot alter payments.branch_id.
--    - Normal payment updates (e.g. invoice_path) remain functional.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_operational_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_multi_branch BOOLEAN;
BEGIN
  -- 1. Guard business_id immutability on UPDATE
  -- Operational records (customers, groups, payments) cannot be moved across businesses.
  IF TG_OP = 'UPDATE' AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'Security violation: business_id is immutable for %', TG_TABLE_NAME;
  END IF;

  -- 2. Check if the record's business has ANY branch configuration (active or inactive).
  -- Deactivating branches never downgrades a multi-branch business to single-tenant mode.
  SELECT EXISTS (
    SELECT 1 FROM public.branches
    WHERE business_id = NEW.business_id
  ) INTO v_is_multi_branch;

  IF v_is_multi_branch THEN
    IF NEW.branch_id IS NULL THEN
      RAISE EXCEPTION 'Multi-branch violation: branch_id is required for % in a multi-branch business', TG_TABLE_NAME;
    END IF;

    -- Ensure target branch is active for new records or branch reassignments
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.branch_id IS DISTINCT FROM OLD.branch_id) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE id = NEW.branch_id
          AND business_id = NEW.business_id
          AND is_active = true
      ) THEN
        RAISE EXCEPTION 'Inactive branch violation: Cannot assign % to an inactive branch (%)', TG_TABLE_NAME, NEW.branch_id;
      END IF;
    END IF;
  END IF;

  -- 3. Guard historical payment branch attribution on payments UPDATE
  IF TG_TABLE_NAME = 'payments' AND TG_OP = 'UPDATE' THEN
    IF OLD.branch_id IS NOT NULL AND NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      IF NOT public.is_business_admin(OLD.business_id) THEN
        RAISE EXCEPTION 'Historical attribution protected: Staff cannot alter payment branch_id';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_operational_branch_id() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_operational_branch_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_operational_branch_id() TO authenticated;

DROP TRIGGER IF EXISTS trg_enforce_customer_branch ON public.customers;
CREATE TRIGGER trg_enforce_customer_branch
  BEFORE INSERT OR UPDATE
  ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_operational_branch_id();

DROP TRIGGER IF EXISTS trg_enforce_group_branch ON public.groups;
CREATE TRIGGER trg_enforce_group_branch
  BEFORE INSERT OR UPDATE
  ON public.groups
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_operational_branch_id();

DROP TRIGGER IF EXISTS trg_enforce_payment_branch ON public.payments;
CREATE TRIGGER trg_enforce_payment_branch
  BEFORE INSERT OR UPDATE
  ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_operational_branch_id();

-- ------------------------------------------------------------
-- 10. PERFORMANCE INDEXES FOR BRANCH FILTERING
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_branches_business_id
  ON public.branches (business_id);

CREATE INDEX IF NOT EXISTS idx_customers_business_branch
  ON public.customers (business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_groups_business_branch
  ON public.groups (business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_payments_business_branch
  ON public.payments (business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_business_users_business_branch
  ON public.business_users (business_id, branch_id);

-- ------------------------------------------------------------
-- 11. SECURITY DEFINER HELPER FUNCTION: has_branch_access (NO RECURSION)
--     Note: public.is_business_admin(UUID) is defined in Section 4a above.
-- ------------------------------------------------------------

-- 11b. Fail-closed branch access evaluator
-- Evaluates business membership, role permissions, and branch restrictions.
-- Handles single-tenant businesses and multi-branch businesses fail-closed.
CREATE OR REPLACE FUNCTION public.has_branch_access(
  p_business_id UUID,
  p_record_branch_id UUID,
  p_require_write BOOLEAN DEFAULT false
)
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
      -- Check role write allowance (ReadOnly cannot write)
      AND (
        (p_require_write = false AND bu.role IN ('Creator', 'Admin', 'Staff', 'ReadOnly'))
        OR (p_require_write = true AND bu.role IN ('Creator', 'Admin', 'Staff'))
      )
      AND (
        -- CASE 1: Single-tenant business (ZERO branches configured in public.branches, active or inactive)
        -- Preserves standard business-level access for MK Venture and other single-branch tenants.
        -- Deactivating branches in a multi-branch business NEVER falls back to Case 1.
        NOT EXISTS (
          SELECT 1 FROM public.branches b WHERE b.business_id = p_business_id
        )
        OR
        -- CASE 2: Multi-branch business: Creator/Admin
        -- Reads: can view all records across active and inactive branches.
        -- Writes: must provide a non-NULL branch_id belonging to an ACTIVE branch in this business.
        (
          bu.role IN ('Creator', 'Admin')
          AND (
            p_require_write = false
            OR (
              p_record_branch_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.branches b
                WHERE b.id = p_record_branch_id
                  AND b.business_id = p_business_id
                  AND b.is_active = true
              )
            )
          )
        )
        OR
        -- CASE 3: Multi-branch business: Staff MUST be assigned to a branch, and record must match.
        -- Reads: strictly restricted to assigned branch even if one or all branches are inactive.
        -- Writes: additionally requires the assigned branch to be currently ACTIVE.
        (
          bu.role = 'Staff'
          AND bu.branch_id IS NOT NULL
          AND p_record_branch_id IS NOT NULL
          AND bu.branch_id = p_record_branch_id
          AND (
            p_require_write = false
            OR EXISTS (
              SELECT 1 FROM public.branches b
              WHERE b.id = p_record_branch_id
                AND b.business_id = p_business_id
                AND b.is_active = true
            )
          )
        )
        OR
        -- CASE 4: Multi-branch business: ReadOnly
        -- (If assigned to a branch, restricted to that branch; if unassigned, accesses all branches in business)
        (
          bu.role = 'ReadOnly'
          AND (
            bu.branch_id IS NULL
            OR (p_record_branch_id IS NOT NULL AND bu.branch_id = p_record_branch_id)
          )
        )
      )
  );
$$;

ALTER FUNCTION public.has_branch_access(UUID, UUID, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_branch_access(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_branch_access(UUID, UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 12. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------

-- 12a. public.branches RLS — Hardened Fail-Closed SELECT
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business members can view branches" ON public.branches;
CREATE POLICY "Business members can view branches"
  ON public.branches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = branches.business_id
        AND bu.user_id = auth.uid()
        AND (
          -- Creator and Admin can view all branches in their business
          bu.role IN ('Creator', 'Admin')
          -- Staff can ONLY view their specifically assigned branch (fail-closed: unassigned Staff see 0 branches)
          OR (bu.role = 'Staff' AND bu.branch_id IS NOT NULL AND bu.branch_id = branches.id)
          -- ReadOnly: if assigned to a branch, restricted to that branch; if unassigned, views all branches in business
          OR (bu.role = 'ReadOnly' AND (bu.branch_id IS NULL OR bu.branch_id = branches.id))
        )
    )
  );

DROP POLICY IF EXISTS "Business admins can manage branches" ON public.branches;
CREATE POLICY "Business admins can manage branches"
  ON public.branches
  FOR ALL
  TO authenticated
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

-- 12b. public.customers (Students) RLS — Drop Legacy Broad Policy & Replace
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can access data in their business" ON public.customers;
DROP POLICY IF EXISTS "Business members can view students" ON public.customers;
DROP POLICY IF EXISTS "Business write users can insert students" ON public.customers;
DROP POLICY IF EXISTS "Business write users can update students" ON public.customers;
DROP POLICY IF EXISTS "Business write users can delete students" ON public.customers;

CREATE POLICY "Business members can view students"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (public.has_branch_access(business_id, branch_id, false));

CREATE POLICY "Business write users can insert students"
  ON public.customers
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_branch_access(business_id, branch_id, true));

CREATE POLICY "Business write users can update students"
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (public.has_branch_access(business_id, branch_id, true))
  WITH CHECK (public.has_branch_access(business_id, branch_id, true));

CREATE POLICY "Business write users can delete students"
  ON public.customers
  FOR DELETE
  TO authenticated
  USING (public.has_branch_access(business_id, branch_id, true));

-- 12c. public.groups (Classes) RLS — Drop Legacy Broad Policy & Replace
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can access data in their business" ON public.groups;
DROP POLICY IF EXISTS "Business members can view classes" ON public.groups;
DROP POLICY IF EXISTS "Business write users can insert classes" ON public.groups;
DROP POLICY IF EXISTS "Business write users can update classes" ON public.groups;
DROP POLICY IF EXISTS "Business write users can delete classes" ON public.groups;

CREATE POLICY "Business members can view classes"
  ON public.groups
  FOR SELECT
  TO authenticated
  USING (public.has_branch_access(business_id, branch_id, false));

CREATE POLICY "Business write users can insert classes"
  ON public.groups
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_branch_access(business_id, branch_id, true));

CREATE POLICY "Business write users can update classes"
  ON public.groups
  FOR UPDATE
  TO authenticated
  USING (public.has_branch_access(business_id, branch_id, true))
  WITH CHECK (public.has_branch_access(business_id, branch_id, true));

CREATE POLICY "Business write users can delete classes"
  ON public.groups
  FOR DELETE
  TO authenticated
  USING (public.has_branch_access(business_id, branch_id, true));

-- 12d. public.payments RLS — Updated with Fail-Closed Branch Scoping
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Business members can view payments" ON public.payments;
DROP POLICY IF EXISTS "Business write users can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Business write users can update payments" ON public.payments;
DROP POLICY IF EXISTS "Business write users can delete payments" ON public.payments;

CREATE POLICY "Business members can view payments"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (public.has_branch_access(business_id, branch_id, false));

CREATE POLICY "Business write users can insert payments"
  ON public.payments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_branch_access(business_id, branch_id, true));

CREATE POLICY "Business write users can update payments"
  ON public.payments
  FOR UPDATE
  TO authenticated
  USING (public.has_branch_access(business_id, branch_id, true))
  WITH CHECK (public.has_branch_access(business_id, branch_id, true));

CREATE POLICY "Business write users can delete payments"
  ON public.payments
  FOR DELETE
  TO authenticated
  USING (public.has_branch_access(business_id, branch_id, true));

-- 12e. public.business_users RLS — Non-Recursive Admin Update Policy (Permissive + Restrictive)
-- Staff cannot update business_users, modify roles, or change their own or another user's branch assignment.
-- Explicitly drops any legacy broad FOR ALL policy if present, defines the permissive Admin UPDATE policy,
-- and enforces an AS RESTRICTIVE UPDATE policy so no permissive policy can ever grant non-Admin UPDATE access.
ALTER TABLE public.business_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can access data in their business" ON public.business_users;
DROP POLICY IF EXISTS "Admins can update business user branch and role" ON public.business_users;
DROP POLICY IF EXISTS "Restrict business_users updates to admins" ON public.business_users;

CREATE POLICY "Admins can update business user branch and role"
  ON public.business_users
  FOR UPDATE
  TO authenticated
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

CREATE POLICY "Restrict business_users updates to admins"
  ON public.business_users
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

-- 12f. storage.objects DELETE Policy — Hardened Branch-Isolated Invoice Deletion
-- Enforces that Staff can only delete invoice files for payments within their assigned branch.
-- Validates that the payment belongs to the caller's permitted branch via payments RLS.
DROP POLICY IF EXISTS "Business write users can delete business invoices" ON storage.objects;
CREATE POLICY "Business write users can delete business invoices"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'invoices'
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id::text = (storage.foldername(name))[1]
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
    AND EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.business_id::text = (storage.foldername(name))[1]
    )
  );

COMMIT;
