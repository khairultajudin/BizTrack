-- ============================================================
-- BIZTRACK MIGRATION 07 ROLLBACK: REVERT MULTI-BRANCH MANAGEMENT (HARDENED - PHASE 1Q)
-- ============================================================
-- Confirmed Production Target: PUSAT TUISYEN AKADEMIK MEGA (UUID: 978d2b0c-6a2b-4c28-9000-71dc23f96781)
-- Confirmed Target Owner: NORHANA ABDUL RANI (akademikmega.admin@gmail.com, Auth UID: d2b660bf-10d3-4d94-94ec-0b8f6e0908e6)
-- Protected Workspace (DO NOT MODIFY): Akademik Mega (UUID: ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad)
-- NOTE: DO NOT EXECUTE AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.
--
-- Safety & Precondition Guarantees:
-- 1. Explicit Transaction Wrapping: All DDL enclosed in BEGIN ... COMMIT.
-- 2. Non-Default Branch Configuration & Data Protection:
--    - Rollback ABORTS if ANY secondary branch configuration exists (e.g. Kelisa Emas),
--      even if it contains 0 active records, preventing accidental loss of branch setup.
--    - Rollback ABORTS if ANY active data exists in secondary branches across
--      students, classes, payments, or business_users.
-- 3. Incomplete Assignment Guard: Detects NULL branch assignments in target multi-branch business
--    across students, classes, payments, and staff users.
-- 4. Clean Reversion of Triggers & Constraints:
--    - Drops enforce_operational_branch_id triggers and function.
--    - Drops protect_business_users_immutability trigger and function.
--    - Drops check_student_class_branch trigger and function.
-- 5. Task 1 Functionality Preservation:
--    - Exact Migration 06 payments RLS policies are restored.
--    - Exact Migration 06 storage.objects DELETE policy is restored.
--    - invoice_path and storage.objects bucket policies remain 100% operational.
-- 6. Documented Security Impact:
--    - Restoring legacy broad policies returns customers and groups to business-wide visibility.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. PRECONDITION & DATA LOSS SAFETY CHECK
--    Detects secondary branch configuration, active data, or unassigned records.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_target_biz_id CONSTANT UUID := '978d2b0c-6a2b-4c28-9000-71dc23f96781';
  v_protected_biz_id CONSTANT UUID := 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';
  v_other_biz_branch_data INT := 0;
  v_secondary_branches_count INT := 0;
  v_non_default_custs INT := 0;
  v_non_default_groups INT := 0;
  v_non_default_payments INT := 0;
  v_non_default_users INT := 0;
  v_null_branch_custs INT := 0;
  v_null_branch_groups INT := 0;
  v_null_branch_payments INT := 0;
  v_null_branch_staff INT := 0;
  v_force_rollback TEXT;
BEGIN
  -- Read optional safety override
  v_force_rollback := current_setting('biztrack.allow_forced_rollback', true);

  -- Only perform check if public.branches exists
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'branches') THEN

    -- 0. Verify no non-target or protected workspace (including ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad)
    --    contains any branch configuration or branch_id assignments
    SELECT
      (SELECT COUNT(*) FROM public.branches WHERE business_id <> v_target_biz_id) +
      (SELECT COUNT(*) FROM public.customers WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL) +
      (SELECT COUNT(*) FROM public.groups WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL) +
      (SELECT COUNT(*) FROM public.payments WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL) +
      (SELECT COUNT(*) FROM public.business_users WHERE business_id <> v_target_biz_id AND branch_id IS NOT NULL)
    INTO v_other_biz_branch_data;

    IF v_other_biz_branch_data > 0 AND (v_force_rollback IS NULL OR v_force_rollback <> 'true') THEN
      RAISE EXCEPTION 'Rollback Aborted: Non-target or protected workspace (including %) contains % branch configuration or branch_id records. Refusing to drop branches table.',
        v_protected_biz_id, v_other_biz_branch_data;
    END IF;

    -- 1. Check secondary branches configuration for target business
    SELECT COUNT(*) INTO v_secondary_branches_count
    FROM public.branches
    WHERE business_id = v_target_biz_id
      AND name <> 'Pauh Jaya';

    -- 2. Check students assigned to non-default branches (target business)
    SELECT COUNT(*) INTO v_non_default_custs
    FROM public.customers c
    JOIN public.branches b ON c.branch_id = b.id
    WHERE c.business_id = v_target_biz_id
      AND b.name <> 'Pauh Jaya';

    -- 3. Check classes assigned to non-default branches (target business)
    SELECT COUNT(*) INTO v_non_default_groups
    FROM public.groups g
    JOIN public.branches b ON g.branch_id = b.id
    WHERE g.business_id = v_target_biz_id
      AND b.name <> 'Pauh Jaya';

    -- 4. Check payments assigned to non-default branches (target business)
    SELECT COUNT(*) INTO v_non_default_payments
    FROM public.payments p
    JOIN public.branches b ON p.branch_id = b.id
    WHERE p.business_id = v_target_biz_id
      AND b.name <> 'Pauh Jaya';

    -- 5. Check business_users assigned to non-default branches (target business)
    SELECT COUNT(*) INTO v_non_default_users
    FROM public.business_users bu
    JOIN public.branches b ON bu.branch_id = b.id
    WHERE bu.business_id = v_target_biz_id
      AND b.name <> 'Pauh Jaya';

    -- 6. Check for unassigned staff in target multi-branch business
    SELECT COUNT(*) INTO v_null_branch_staff
    FROM public.business_users
    WHERE business_id = v_target_biz_id AND branch_id IS NULL AND role = 'Staff';

    -- 7. Check for NULL branch_id operational records in target multi-branch business
    SELECT COUNT(*) INTO v_null_branch_custs
    FROM public.customers
    WHERE business_id = v_target_biz_id AND branch_id IS NULL;

    SELECT COUNT(*) INTO v_null_branch_groups
    FROM public.groups
    WHERE business_id = v_target_biz_id AND branch_id IS NULL;

    SELECT COUNT(*) INTO v_null_branch_payments
    FROM public.payments
    WHERE business_id = v_target_biz_id AND branch_id IS NULL;

    -- CRITICAL SAFETY DECISION:
    -- Abort if ANY secondary branch configuration OR active secondary branch records exist
    IF (v_secondary_branches_count > 0 OR v_non_default_custs > 0 OR v_non_default_groups > 0 OR v_non_default_payments > 0 OR v_non_default_users > 0)
       AND (v_force_rollback IS NULL OR v_force_rollback <> 'true') THEN
      RAISE EXCEPTION 'Rollback Aborted: Multi-branch configuration or secondary branch data exists for business % (% secondary branches, % students, % classes, % payments, % users). Rolling back will drop the branches table and all branch_id columns, permanently destroying multi-branch configuration and data segregation. To permanently destroy all branch configuration and force rollback, execute "SET biztrack.allow_forced_rollback = ''true'';" within the database session before running this script.',
        v_target_biz_id, v_secondary_branches_count, v_non_default_custs, v_non_default_groups, v_non_default_payments, v_non_default_users;
    END IF;

    -- Incomplete assignment check in target multi-branch business
    IF (v_null_branch_custs > 0 OR v_null_branch_groups > 0 OR v_null_branch_payments > 0 OR v_null_branch_staff > 0)
       AND (v_force_rollback IS NULL OR v_force_rollback <> 'true') THEN
      RAISE EXCEPTION 'Rollback Aborted: Target business % contains unassigned records (% students, % classes, % payments, % staff users with NULL branch_id). Ensure all operational records are accounted for before rolling back, or execute "SET biztrack.allow_forced_rollback = ''true'';" to proceed.',
        v_target_biz_id, v_null_branch_custs, v_null_branch_groups, v_null_branch_payments, v_null_branch_staff;
    END IF;

  END IF;

  RAISE NOTICE 'Rollback safety checks passed successfully.';
END $$;

-- ------------------------------------------------------------
-- 2. DROP OPERATIONAL BRANCH ENFORCEMENT TRIGGERS & FUNCTION
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_enforce_payment_branch ON public.payments;
DROP TRIGGER IF EXISTS trg_enforce_group_branch ON public.groups;
DROP TRIGGER IF EXISTS trg_enforce_customer_branch ON public.customers;
DROP FUNCTION IF EXISTS public.enforce_operational_branch_id();

-- ------------------------------------------------------------
-- 3. REVERT public.business_users RLS & IMMUTABILITY TRIGGER
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_protect_business_users_immutability ON public.business_users;
DROP FUNCTION IF EXISTS public.protect_business_users_immutability();
DROP POLICY IF EXISTS "Restrict business_users updates to admins" ON public.business_users;
DROP POLICY IF EXISTS "Admins can update business user branch and role" ON public.business_users;

-- ------------------------------------------------------------
-- 4. REVERT public.payments RLS (RESTORE MIGRATION 06 PRODUCTION STATE)
--    Preserves Task 1 Invoice PDF Upload functionality intact.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Business members can view payments" ON public.payments;
CREATE POLICY "Business members can view payments"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = payments.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff', 'ReadOnly')
    )
  );

DROP POLICY IF EXISTS "Business write users can insert payments" ON public.payments;
CREATE POLICY "Business write users can insert payments"
  ON public.payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = payments.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
  );

DROP POLICY IF EXISTS "Business write users can update payments" ON public.payments;
CREATE POLICY "Business write users can update payments"
  ON public.payments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = payments.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = payments.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
  );

DROP POLICY IF EXISTS "Business write users can delete payments" ON public.payments;
CREATE POLICY "Business write users can delete payments"
  ON public.payments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = payments.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
  );

-- ------------------------------------------------------------
-- 5. REVERT public.groups RLS (RESTORE BROAD BUSINESS POLICY)
--    Consequence: Classes are once again visible to all members of the business.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Business members can view classes" ON public.groups;
DROP POLICY IF EXISTS "Business write users can insert classes" ON public.groups;
DROP POLICY IF EXISTS "Business write users can update classes" ON public.groups;
DROP POLICY IF EXISTS "Business write users can delete classes" ON public.groups;

CREATE POLICY "Users can access data in their business"
  ON public.groups
  FOR ALL
  TO public
  USING (business_id IN (SELECT public.user_businesses()));

-- ------------------------------------------------------------
-- 6. REVERT public.customers RLS (RESTORE BROAD BUSINESS POLICY)
--    Consequence: Students are once again visible to all members of the business.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Business members can view students" ON public.customers;
DROP POLICY IF EXISTS "Business write users can insert students" ON public.customers;
DROP POLICY IF EXISTS "Business write users can update students" ON public.customers;
DROP POLICY IF EXISTS "Business write users can delete students" ON public.customers;

CREATE POLICY "Users can access data in their business"
  ON public.customers
  FOR ALL
  TO public
  USING (business_id IN (SELECT public.user_businesses()));

-- ------------------------------------------------------------
-- 7. DROP public.branches POLICIES & SECURITY DEFINER HELPER FUNCTIONS
--    Note: Policies on public.branches depend on public.is_business_admin(UUID),
--    so they must be dropped BEFORE dropping the helper functions.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Business admins can manage branches" ON public.branches;
DROP POLICY IF EXISTS "Business members can view branches" ON public.branches;

DROP FUNCTION IF EXISTS public.has_branch_access(UUID, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.is_business_admin(UUID);

-- ------------------------------------------------------------
-- 8. DROP TRIGGER AND TRIGGER FUNCTION
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_check_student_class_branch ON public.customers;
DROP FUNCTION IF EXISTS public.check_student_class_branch();

-- ------------------------------------------------------------
-- 9. DROP COMPOSITE FOREIGN KEY CONSTRAINTS (SCOPED BY RELCLASS)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_branch_business_fkey'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_branch_business_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'groups_branch_business_fkey'
      AND conrelid = 'public.groups'::regclass
  ) THEN
    ALTER TABLE public.groups DROP CONSTRAINT groups_branch_business_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_branch_business_fkey'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers DROP CONSTRAINT customers_branch_business_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'business_users_branch_business_fkey'
      AND conrelid = 'public.business_users'::regclass
  ) THEN
    ALTER TABLE public.business_users DROP CONSTRAINT business_users_branch_business_fkey;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 10. DROP PERFORMANCE INDEXES
-- ------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_business_users_business_branch;
DROP INDEX IF EXISTS public.idx_payments_business_branch;
DROP INDEX IF EXISTS public.idx_groups_business_branch;
DROP INDEX IF EXISTS public.idx_customers_business_branch;
DROP INDEX IF EXISTS public.idx_branches_business_id;

-- ------------------------------------------------------------
-- 11. DROP branch_id COLUMNS
-- ------------------------------------------------------------
ALTER TABLE public.payments DROP COLUMN IF EXISTS branch_id;
ALTER TABLE public.groups DROP COLUMN IF EXISTS branch_id;
ALTER TABLE public.customers DROP COLUMN IF EXISTS branch_id;
ALTER TABLE public.business_users DROP COLUMN IF EXISTS branch_id;

-- ------------------------------------------------------------
-- 12. DROP public.branches TABLE
-- ------------------------------------------------------------
DROP TABLE IF EXISTS public.branches;

-- ------------------------------------------------------------
-- 13. REVERT storage.objects DELETE POLICY (RESTORE MIGRATION 06)
-- ------------------------------------------------------------
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
  );

COMMIT;
