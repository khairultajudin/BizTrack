-- ============================================================
-- BIZTRACK MIGRATION 08 VERIFICATION & SECURITY TEST SUITE (PHASE 2.1)
-- ============================================================
-- This script contains two distinct verification sections:
--   PART A: Static Catalog, Effective Privilege, ACL, Trigger, FK, RLS &
--           SECURITY DEFINER Metadata Checks
--   PART B: Runtime Authenticated-User Simulation Tests under True Role Switching
--           (Executes inside an isolated BEGIN ... ROLLBACK transaction using
--            SET LOCAL ROLE authenticated and request.jwt.claims to verify
--            runtime RLS & column-grant enforcement, RPC authorization,
--            branch aggregate isolation, permanent historical payroll
--            allocation invariants, and branch expense isolation).
-- ============================================================

-- ============================================================
-- PART A: STATIC CATALOG, PRIVILEGE, RLS, TRIGGER & FUNCTION METADATA CHECKS
-- ============================================================
DO $$
DECLARE
  v_count INT;
  v_staff_rls BOOLEAN;
  v_staff_payments_rls BOOLEAN;
  v_expenses_rls BOOLEAN;
  v_for_all_staff_policies INT;
  v_legacy_payment_policies INT;
  v_legacy_expense_policies INT;
  v_public_acl_count INT;
  v_fn RECORD;
BEGIN
  -- ----------------------------------------------------------
  -- A1. Verify RLS is enabled on public.staff, public.staff_payments & public.expenses
  -- ----------------------------------------------------------
  SELECT relrowsecurity INTO v_staff_rls
  FROM pg_class WHERE oid = 'public.staff'::regclass;
  IF NOT COALESCE(v_staff_rls, FALSE) THEN
    RAISE EXCEPTION 'SECURITY FAILURE: RLS is not enabled on public.staff';
  END IF;

  SELECT relrowsecurity INTO v_staff_payments_rls
  FROM pg_class WHERE oid = 'public.staff_payments'::regclass;
  IF NOT COALESCE(v_staff_payments_rls, FALSE) THEN
    RAISE EXCEPTION 'SECURITY FAILURE: RLS is not enabled on public.staff_payments';
  END IF;

  SELECT relrowsecurity INTO v_expenses_rls
  FROM pg_class WHERE oid = 'public.expenses'::regclass;
  IF NOT COALESCE(v_expenses_rls, FALSE) THEN
    RAISE EXCEPTION 'SECURITY FAILURE: RLS is not enabled on public.expenses';
  END IF;

  -- ----------------------------------------------------------
  -- A2. Verify branch_id Columns, Composite FKs & Triggers Exist
  -- ----------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'branch_id'
  ) THEN
    RAISE EXCEPTION 'SCHEMA FAILURE: public.staff.branch_id is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_payments' AND column_name = 'branch_id'
  ) THEN
    RAISE EXCEPTION 'SCHEMA FAILURE: public.staff_payments.branch_id is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'branch_id'
  ) THEN
    RAISE EXCEPTION 'SCHEMA FAILURE: public.expenses.branch_id is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_branch_business_fkey' AND conrelid = 'public.staff'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_payments_branch_business_fkey' AND conrelid = 'public.staff_payments'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expenses_branch_business_fkey' AND conrelid = 'public.expenses'::regclass
  ) THEN
    RAISE EXCEPTION 'SCHEMA FAILURE: Missing composite foreign key (branch_id, business_id) on staff, staff_payments, or expenses';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_staff_branch' AND tgrelid = 'public.staff'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_staff_payment_branch' AND tgrelid = 'public.staff_payments'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_expense_branch' AND tgrelid = 'public.expenses'::regclass
  ) THEN
    RAISE EXCEPTION 'SCHEMA FAILURE: Missing branch enforcement trigger on staff, staff_payments, or expenses';
  END IF;

  -- ----------------------------------------------------------
  -- A3. Verify Table-Level Privileges & Catalog ACLs (aclexplode)
  --     (Table-level SELECT, INSERT, UPDATE, DELETE on public.staff MUST be FALSE
  --      for authenticated, anon, and PUBLIC)
  -- ----------------------------------------------------------
  IF has_table_privilege('authenticated', 'public.staff', 'SELECT') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: Table-level SELECT is still granted on public.staff to authenticated';
  END IF;

  IF has_table_privilege('authenticated', 'public.staff', 'INSERT') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: Table-level INSERT is granted on public.staff to authenticated';
  END IF;

  IF has_table_privilege('authenticated', 'public.staff', 'UPDATE') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: Table-level UPDATE is granted on public.staff to authenticated';
  END IF;

  IF has_table_privilege('authenticated', 'public.staff', 'DELETE') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: Table-level DELETE is granted on public.staff to authenticated';
  END IF;

  IF has_table_privilege('anon', 'public.staff', 'SELECT')
     OR has_table_privilege('anon', 'public.staff', 'INSERT')
     OR has_table_privilege('anon', 'public.staff', 'UPDATE')
     OR has_table_privilege('anon', 'public.staff', 'DELETE') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: anon role has privileges on public.staff';
  END IF;

  IF has_table_privilege('anon', 'public.staff_payments', 'SELECT')
     OR has_table_privilege('anon', 'public.staff_payments', 'INSERT')
     OR has_table_privilege('anon', 'public.staff_payments', 'UPDATE')
     OR has_table_privilege('anon', 'public.staff_payments', 'DELETE') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: anon role has privileges on public.staff_payments';
  END IF;

  IF has_table_privilege('anon', 'public.expenses', 'SELECT')
     OR has_table_privilege('anon', 'public.expenses', 'INSERT')
     OR has_table_privilege('anon', 'public.expenses', 'UPDATE')
     OR has_table_privilege('anon', 'public.expenses', 'DELETE') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: anon role has privileges on public.expenses';
  END IF;

  -- Inspect aclexplode(relacl) directly to confirm zero PUBLIC (grantee = 0) grants
  SELECT COUNT(*) INTO v_public_acl_count
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, ARRAY[]::aclitem[])) a
  WHERE c.oid IN ('public.staff'::regclass, 'public.staff_payments'::regclass, 'public.expenses'::regclass)
    AND a.grantee = 0;

  IF v_public_acl_count > 0 THEN
    RAISE EXCEPTION 'SECURITY FAILURE: PUBLIC (grantee=0) still holds table-level ACL entries on staff, staff_payments, or expenses';
  END IF;

  -- ----------------------------------------------------------
  -- A4. Verify Column-Level Privileges on public.staff
  --     - salary_amount & salary_type: SELECT/INSERT/UPDATE MUST be FALSE
  --     - Directory columns (including branch_id): SELECT MUST be TRUE, INSERT/UPDATE MUST be FALSE
  -- ----------------------------------------------------------
  IF has_column_privilege('authenticated', 'public.staff', 'salary_amount', 'SELECT')
     OR has_column_privilege('authenticated', 'public.staff', 'salary_amount', 'INSERT')
     OR has_column_privilege('authenticated', 'public.staff', 'salary_amount', 'UPDATE') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: authenticated has privileges on public.staff(salary_amount)';
  END IF;

  IF has_column_privilege('authenticated', 'public.staff', 'salary_type', 'SELECT')
     OR has_column_privilege('authenticated', 'public.staff', 'salary_type', 'INSERT')
     OR has_column_privilege('authenticated', 'public.staff', 'salary_type', 'UPDATE') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: authenticated has privileges on public.staff(salary_type)';
  END IF;

  IF has_column_privilege('authenticated', 'public.staff', 'phone', 'SELECT')
     OR has_column_privilege('authenticated', 'public.staff', 'phone', 'INSERT')
     OR has_column_privilege('authenticated', 'public.staff', 'phone', 'UPDATE') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: authenticated has privileges on public.staff(phone)';
  END IF;

  IF has_column_privilege('authenticated', 'public.staff', 'notes', 'SELECT')
     OR has_column_privilege('authenticated', 'public.staff', 'notes', 'INSERT')
     OR has_column_privilege('authenticated', 'public.staff', 'notes', 'UPDATE') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: authenticated has privileges on public.staff(notes)';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.staff', 'id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.staff', 'business_id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.staff', 'branch_id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.staff', 'name', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.staff', 'role', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.staff', 'created_at', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.staff', 'deleted_at', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.staff', 'deleted_by', 'SELECT') THEN
    RAISE EXCEPTION 'REGRESSION FAILURE: authenticated is missing SELECT on non-sensitive staff directory columns';
  END IF;

  IF has_column_privilege('authenticated', 'public.staff', 'name', 'INSERT')
     OR has_column_privilege('authenticated', 'public.staff', 'name', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.staff', 'branch_id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.staff', 'branch_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.staff', 'role', 'INSERT')
     OR has_column_privilege('authenticated', 'public.staff', 'role', 'UPDATE') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: authenticated still has column-level INSERT/UPDATE privileges on public.staff';
  END IF;

  -- ----------------------------------------------------------
  -- A5. Verify RLS Policies on public.staff, public.staff_payments & public.expenses
  -- ----------------------------------------------------------
  SELECT COUNT(*) INTO v_for_all_staff_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'staff'
    AND cmd = 'ALL';

  IF v_for_all_staff_policies > 0 THEN
    RAISE EXCEPTION 'SECURITY FAILURE: Permissive FOR ALL policy still exists on public.staff';
  END IF;

  SELECT COUNT(*) INTO v_legacy_payment_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'staff_payments'
    AND policyname = 'Users can access data in their business';

  IF v_legacy_payment_policies > 0 THEN
    RAISE EXCEPTION 'SECURITY FAILURE: Legacy business-wide policy still exists on public.staff_payments';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staff_payments'
      AND policyname = 'Authorized salary manager can access staff payments'
  ) THEN
    RAISE EXCEPTION 'SECURITY FAILURE: Hardened policy missing on public.staff_payments';
  END IF;

  SELECT COUNT(*) INTO v_legacy_expense_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'expenses'
    AND policyname = 'Users can access data in their business';

  IF v_legacy_expense_policies > 0 THEN
    RAISE EXCEPTION 'SECURITY FAILURE: Legacy business-wide policy still exists on public.expenses';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'expenses'
      AND policyname = 'Business members can view expenses'
  ) THEN
    RAISE EXCEPTION 'SECURITY FAILURE: Branch-scoped SELECT policy missing on public.expenses';
  END IF;

  -- ----------------------------------------------------------
  -- A6. Verify SECURITY DEFINER Function Ownership, search_path & Execute Grants
  -- ----------------------------------------------------------
  FOR v_fn IN
    SELECT
      p.oid::regprocedure::text AS sig,
      pg_get_userbyid(p.proowner) AS owner_name,
      p.prosecdef AS is_secdef,
      COALESCE(array_to_string(p.proconfig, ','), '') AS config_str
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'is_salary_authorized',
        'get_teachers_with_salary',
        'get_staff_directory',
        'save_teacher_with_salary',
        'delete_teacher',
        'get_staff_expenses_summary',
        'get_expenses_summary',
        'get_monthly_expenses_summary',
        'get_financial_summary',
        'get_monthly_financial_summary',
        'get_payroll_reconciliation_summary',
        'get_historical_payroll_audit',
        'assign_staff_payment_branch',
        'enforce_staff_branch',
        'enforce_staff_payment_branch',
        'enforce_expense_branch'
      )
  LOOP
    IF v_fn.owner_name <> 'postgres' THEN
      RAISE EXCEPTION 'SECURITY FAILURE: Function % is owned by % instead of postgres', v_fn.sig, v_fn.owner_name;
    END IF;

    IF NOT v_fn.is_secdef THEN
      RAISE EXCEPTION 'SECURITY FAILURE: Function % is not SECURITY DEFINER', v_fn.sig;
    END IF;

    IF POSITION('search_path=public, pg_temp' IN v_fn.config_str) = 0 THEN
      RAISE EXCEPTION 'SECURITY FAILURE: Function % does not have pinned search_path=public, pg_temp (found: %)', v_fn.sig, v_fn.config_str;
    END IF;

    IF has_function_privilege('anon', v_fn.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'SECURITY FAILURE: anon role has EXECUTE privilege on %', v_fn.sig;
    END IF;

    IF NOT has_function_privilege('authenticated', v_fn.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'REGRESSION FAILURE: authenticated role lacks EXECUTE privilege on %', v_fn.sig;
    END IF;
  END LOOP;

  -- Verify internal helper resolve_authorized_expense_branch is NOT directly callable by anon/authenticated
  IF has_function_privilege('authenticated', 'public.resolve_authorized_expense_branch(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.resolve_authorized_expense_branch(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY FAILURE: resolve_authorized_expense_branch must not be directly executable by anon/authenticated';
  END IF;

  -- Verify deterministic deleted_by foreign keys on staff, groups, staff_payments, expenses
  SELECT COUNT(*) INTO v_count
  FROM pg_constraint c
  JOIN pg_class tbl ON tbl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = tbl.relnamespace
  WHERE n.nspname = 'public'
    AND c.contype = 'f'
    AND c.confrelid = 'public.profiles'::regclass
    AND c.confdeltype = 'n'
    AND (tbl.relname, c.conname) IN (
      ('staff', 'staff_deleted_by_fkey'),
      ('groups', 'groups_deleted_by_fkey'),
      ('staff_payments', 'staff_payments_deleted_by_fkey'),
      ('expenses', 'expenses_deleted_by_fkey')
    );
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'REGRESSION FAILURE: Expected 4 deterministic deleted_by FKs on staff/groups/staff_payments/expenses, found %', v_count;
  END IF;

  RAISE NOTICE 'PART A PASSED: Static privileges, column ACLs, composite FKs, triggers, RLS policies, and SECURITY DEFINER metadata verified.';
END $$;

-- ============================================================
-- PART B: ISOLATED TRANSACTIONAL AUTHENTICATED-USER SIMULATION TESTS
--         (Executes under true SET LOCAL ROLE authenticated; all test data
--          rolls back cleanly at the end)
-- ============================================================
BEGIN;

DO $$
DECLARE
  v_target_biz CONSTANT UUID := '978d2b0c-6a2b-4c28-9000-71dc23f96781';
  v_protected_biz CONSTANT UUID := 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';
  v_hana_uid CONSTANT UUID := 'd2b660bf-10d3-4d94-94ec-0b8f6e0908e6';
  v_pauh_uid CONSTANT UUID := '1d602572-2048-4526-bac0-05839ac06471';
  v_kelisa_uid CONSTANT UUID := '2877f207-c3ff-4339-ad4e-823a3bd24e5f';
  v_other_creator_uid CONSTANT UUID := 'a11c9c2b-364d-4aca-b6f1-90e9024c4a6e';
  v_unassigned_staff_uid CONSTANT UUID := 'b22d8d3c-475e-4bdb-a7e2-81f8135d5b7f';
  v_outsider_uid CONSTANT UUID := 'c33e7e4d-586f-4cec-b8f3-72a9246e6c8a';
  v_readonly_pauh_uid CONSTANT UUID := 'd44f6f5e-697a-4dfd-99a4-83b0357f7d9b';
  v_readonly_biz_uid CONSTANT UUID := 'e55a7a6f-7a8b-4eae-8ab5-94c1468a8e0c';

  v_pauh_branch_id UUID;
  v_kelisa_branch_id UUID;
  v_test_teacher_pauh UUID;
  v_test_teacher_noclass UUID;
  v_test_teacher_kelisa UUID;
  v_test_class_pauh UUID;
  v_test_class_kelisa UUID;
  v_test_class_kelisa_inactive UUID;
  v_test_class_kelisa_softdel UUID;
  v_test_payment_pauh UUID;
  v_test_payment_noclass UUID;
  v_test_payment_kelisa UUID;
  v_test_payment_transfer UUID;
  v_test_expense_pauh UUID;
  v_test_expense_kelisa UUID;

  v_is_super BOOLEAN;
  v_bypass_rls BOOLEAN;
  v_count INT;
  v_sum NUMERIC;
  v_summary_total NUMERIC;
  v_sum_pauh NUMERIC;
  v_sum_kelisa NUMERIC;
  v_err_caught BOOLEAN;
  v_sqlstate TEXT;
  v_err_msg TEXT;
  v_unmapped_500_id UUID;
BEGIN
  -- Resolve branch IDs for target business (as postgres before switching to authenticated)
  SELECT id INTO v_pauh_branch_id
  FROM public.branches
  WHERE business_id = v_target_biz AND name ILIKE '%Pauh Jaya%'
  LIMIT 1;

  SELECT id INTO v_kelisa_branch_id
  FROM public.branches
  WHERE business_id = v_target_biz AND name ILIKE '%Kelisa Emas%'
  LIMIT 1;

  IF v_pauh_branch_id IS NULL OR v_kelisa_branch_id IS NULL THEN
    RAISE EXCEPTION 'Test prerequisite failed: Could not resolve Pauh Jaya or Kelisa Emas branch IDs for business %', v_target_biz;
  END IF;

  -- Provision temporary test identities in auth.users, public.profiles & public.business_users (inside transaction)
  INSERT INTO auth.users (id, email)
  VALUES
    (v_pauh_uid, 'akademikmega.pauhjaya@gmail.com'),
    (v_kelisa_uid, 'akademikmega.kelisaemas@gmail.com'),
    (v_other_creator_uid, 'other.creator@test.local'),
    (v_unassigned_staff_uid, 'unassigned.staff@test.local'),
    (v_outsider_uid, 'outsider@test.local'),
    (v_readonly_pauh_uid, 'readonly.pauh@test.local'),
    (v_readonly_biz_uid, 'readonly.biz@test.local')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES
    (v_pauh_uid, 'akademikmega.pauhjaya@gmail.com', 'Pauh Jaya Staff'),
    (v_kelisa_uid, 'akademikmega.kelisaemas@gmail.com', 'Kelisa Emas Staff'),
    (v_other_creator_uid, 'other.creator@test.local', 'Other Creator'),
    (v_unassigned_staff_uid, 'unassigned.staff@test.local', 'Unassigned Staff'),
    (v_outsider_uid, 'outsider@test.local', 'Outsider User'),
    (v_readonly_pauh_uid, 'readonly.pauh@test.local', 'ReadOnly Pauh'),
    (v_readonly_biz_uid, 'readonly.biz@test.local', 'ReadOnly Biz')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.business_users (business_id, user_id, role, branch_id)
  VALUES
    (v_target_biz, v_pauh_uid, 'Staff', v_pauh_branch_id),
    (v_target_biz, v_kelisa_uid, 'Staff', v_kelisa_branch_id),
    (v_target_biz, v_other_creator_uid, 'Creator', NULL),
    (v_target_biz, v_unassigned_staff_uid, 'Staff', NULL),
    (v_target_biz, v_readonly_pauh_uid, 'ReadOnly', v_pauh_branch_id),
    (v_target_biz, v_readonly_biz_uid, 'ReadOnly', NULL)
  ON CONFLICT (business_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, branch_id = EXCLUDED.branch_id;

  -- Seed a pre-migration unmapped payment (RM 500, branch_id = NULL) in 'ReconMonth' 2099
  -- to test the exact 3,700 + 1,800 + 500 = 6,000 reconciliation scenario under authenticated role
  INSERT INTO public.staff (id, business_id, branch_id, name, role, salary_type, salary_amount)
  VALUES ('55555555-5555-4555-8555-555555555599', v_target_biz, NULL, 'Recon Unmapped Teacher', 'Relief', 'Monthly', 500)
  ON CONFLICT (id) DO NOTHING;

  ALTER TABLE public.staff_payments DISABLE TRIGGER trg_enforce_staff_payment_branch;
  INSERT INTO public.staff_payments (id, business_id, branch_id, staff_id, amount, month, year, date, notes)
  VALUES ('55555555-5555-4555-8555-555555555598', v_target_biz, NULL, '55555555-5555-4555-8555-555555555599', 500, 'ReconMonth', 2099, CURRENT_DATE, 'Unmapped historical RM 500')
  ON CONFLICT (id) DO NOTHING;
  v_unmapped_500_id := '55555555-5555-4555-8555-555555555598';
  ALTER TABLE public.staff_payments ENABLE TRIGGER trg_enforce_staff_payment_branch;

  -- Switch execution context to non-superuser, non-bypassrls 'authenticated' role
  SET LOCAL ROLE authenticated;

  SELECT rolsuper, rolbypassrls INTO v_is_super, v_bypass_rls
  FROM pg_roles WHERE rolname = current_user;

  IF current_user <> 'authenticated' OR v_is_super OR v_bypass_rls THEN
    RAISE EXCEPTION 'ROLE SWITCH FAILURE: Expected non-superuser, non-bypassrls authenticated role, got user=%, super=%, bypassrls=%',
      current_user, v_is_super, v_bypass_rls;
  END IF;

  -- ----------------------------------------------------------
  -- B1. Simulate Puan Hana (Authorized Salary Administrator)
  -- ----------------------------------------------------------
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);

  IF auth.uid() <> v_hana_uid THEN
    RAISE EXCEPTION 'JWT CLAIM FAILURE: Expected auth.uid() = %, got %', v_hana_uid, auth.uid();
  END IF;

  IF NOT public.is_salary_authorized(v_target_biz) THEN
    RAISE EXCEPTION 'TEST FAILURE (B1): Puan Hana must be authorized for target business %', v_target_biz;
  END IF;

  IF public.is_salary_authorized(v_protected_biz) THEN
    RAISE EXCEPTION 'TEST FAILURE (B1): Puan Hana must NOT be authorized for protected workspace %', v_protected_biz;
  END IF;

  -- Create 3 test teachers via authorized RPC:
  -- 1) Pauh Jaya teacher with active class (RM 2200)
  -- 2) Pauh Jaya teacher with NO active class (RM 1500)
  -- 3) Kelisa Emas teacher with active class (RM 1800)
  v_test_teacher_pauh := public.save_teacher_with_salary(
    v_target_biz, 'Test Teacher Pauh Jaya', 'Science Teacher', '0120000001', 'Monthly', 2200, 'Test note PJ', NULL, v_pauh_branch_id
  );
  v_test_teacher_noclass := public.save_teacher_with_salary(
    v_target_biz, 'Test Teacher No Class PJ', 'BM Teacher', '0120000003', 'Monthly', 1500, 'No active class PJ', NULL, v_pauh_branch_id
  );
  v_test_teacher_kelisa := public.save_teacher_with_salary(
    v_target_biz, 'Test Teacher Kelisa Emas', 'Math Teacher', '0120000002', 'Monthly', 1800, 'Test note KE', NULL, v_kelisa_branch_id
  );

  -- Verify get_teachers_with_salary returns all 3 test teachers with exact salary_amount and branch_id
  SELECT COUNT(*) INTO v_count
  FROM public.get_teachers_with_salary(v_target_biz)
  WHERE id IN (v_test_teacher_pauh, v_test_teacher_noclass, v_test_teacher_kelisa)
    AND salary_amount IN (2200, 1500, 1800)
    AND branch_id IN (v_pauh_branch_id, v_kelisa_branch_id);

  IF v_count <> 3 THEN
    RAISE EXCEPTION 'TEST FAILURE (B1): get_teachers_with_salary did not return expected 3 test teachers for Puan Hana';
  END IF;

  -- Create branch classes for only 2 of the 3 teachers (leaving v_test_teacher_noclass with zero classes)
  INSERT INTO public.groups (business_id, branch_id, name, teacher_id, monthly_fee, status)
  VALUES (v_target_biz, v_pauh_branch_id, 'Test Class PJ', v_test_teacher_pauh, 100, 'Active')
  RETURNING id INTO v_test_class_pauh;

  INSERT INTO public.groups (business_id, branch_id, name, teacher_id, monthly_fee, status)
  VALUES (v_target_biz, v_kelisa_branch_id, 'Test Class KE', v_test_teacher_kelisa, 100, 'Active')
  RETURNING id INTO v_test_class_kelisa;

  -- Also seed an Inactive class and a Soft-Deleted class for v_test_teacher_kelisa
  -- to prove delete_teacher() preserves historical class relationships
  INSERT INTO public.groups (business_id, branch_id, name, teacher_id, monthly_fee, status, deleted_at)
  VALUES (v_target_biz, v_kelisa_branch_id, 'Test Inactive Class KE', v_test_teacher_kelisa, 100, 'Inactive', NULL)
  RETURNING id INTO v_test_class_kelisa_inactive;

  INSERT INTO public.groups (business_id, branch_id, name, teacher_id, monthly_fee, status, deleted_at)
  VALUES (v_target_biz, v_pauh_branch_id, 'Test SoftDel Class PJ', v_test_teacher_kelisa, 100, 'Active', NOW())
  RETURNING id INTO v_test_class_kelisa_softdel;

  -- Record staff_payments in 'TestMonth' 2099:
  -- Note: Omit branch_id on the first two inserts to verify trg_enforce_staff_payment_branch
  -- automatically populates sp.branch_id from staff.branch_id!
  INSERT INTO public.staff_payments (business_id, staff_id, amount, month, year, date, notes)
  VALUES (v_target_biz, v_test_teacher_pauh, 2200, 'TestMonth', 2099, CURRENT_DATE, 'Auto branch PJ')
  RETURNING id INTO v_test_payment_pauh;

  INSERT INTO public.staff_payments (business_id, staff_id, amount, month, year, date, notes)
  VALUES (v_target_biz, v_test_teacher_noclass, 1500, 'TestMonth', 2099, CURRENT_DATE, 'No class teacher PJ')
  RETURNING id INTO v_test_payment_noclass;

  INSERT INTO public.staff_payments (business_id, branch_id, staff_id, amount, month, year, date, notes)
  VALUES (v_target_biz, v_kelisa_branch_id, v_test_teacher_kelisa, 1800, 'TestMonth', 2099, CURRENT_DATE, 'Explicit branch KE')
  RETURNING id INTO v_test_payment_kelisa;

  -- Verify trigger populated branch_id on staff_payments
  SELECT COUNT(*) INTO v_count
  FROM public.staff_payments
  WHERE id IN (v_test_payment_pauh, v_test_payment_noclass)
    AND branch_id = v_pauh_branch_id;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILURE (B1): trg_enforce_staff_payment_branch did not auto-populate branch_id from staff.branch_id';
  END IF;

  -- Verify Puan Hana consolidated summary (p_branch_id = NULL) returns 2200 + 1500 + 1800 = 5500
  v_sum := public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, NULL);
  IF v_sum <> 5500 THEN
    RAISE EXCEPTION 'TEST FAILURE (B1): Expected consolidated summary 5500 for Puan Hana, got %', v_sum;
  END IF;

  -- Verify Puan Hana per-branch summaries: Pauh Jaya = 3700 (2200 + 1500), Kelisa Emas = 1800
  v_sum_pauh := public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_pauh_branch_id);
  v_sum_kelisa := public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_kelisa_branch_id);

  IF v_sum_pauh <> 3700 THEN
    RAISE EXCEPTION 'TEST FAILURE (B1): Expected Pauh Jaya summary 3700 (including teacher with no class), got %', v_sum_pauh;
  END IF;
  IF v_sum_kelisa <> 1800 THEN
    RAISE EXCEPTION 'TEST FAILURE (B1): Expected Kelisa Emas summary 1800, got %', v_sum_kelisa;
  END IF;
  IF v_sum <> (v_sum_pauh + v_sum_kelisa) THEN
    RAISE EXCEPTION 'TEST FAILURE (B1): Consolidated payroll (%) does not reconcile with sum of branches (%)',
      v_sum, (v_sum_pauh + v_sum_kelisa);
  END IF;

  -- ----------------------------------------------------------
  -- B2. Simulate Pauh Jaya Staff (Restricted Branch Staff)
  -- ----------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_pauh_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pauh_uid::text, 'role', 'authenticated')::text, true);

  IF current_user <> 'authenticated' OR auth.uid() <> v_pauh_uid THEN
    RAISE EXCEPTION 'ROLE/JWT FAILURE (B2): user=%, uid=%', current_user, auth.uid();
  END IF;

  IF public.is_salary_authorized(v_target_biz) THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff must NOT be salary authorized';
  END IF;

  -- Verify direct column SELECT on salary_amount / salary_type is denied by column-level privileges
  v_err_caught := FALSE;
  BEGIN
    EXECUTE 'SELECT salary_amount FROM public.staff LIMIT 1';
  EXCEPTION WHEN insufficient_privilege THEN
    v_err_caught := TRUE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff was not denied direct SELECT on public.staff(salary_amount)';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    EXECUTE 'SELECT salary_type FROM public.staff LIMIT 1';
  EXCEPTION WHEN insufficient_privilege THEN
    v_err_caught := TRUE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff was not denied direct SELECT on public.staff(salary_type)';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    EXECUTE 'SELECT phone FROM public.staff LIMIT 1';
  EXCEPTION WHEN insufficient_privilege THEN
    v_err_caught := TRUE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff was not denied direct SELECT on public.staff(phone)';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    EXECUTE 'SELECT notes FROM public.staff LIMIT 1';
  EXCEPTION WHEN insufficient_privilege THEN
    v_err_caught := TRUE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff was not denied direct SELECT on public.staff(notes)';
  END IF;

  -- Verify direct INSERT, UPDATE, DELETE on public.staff are denied by privileges
  v_err_caught := FALSE;
  BEGIN
    EXECUTE format('INSERT INTO public.staff (business_id, name, role) VALUES (%L, ''Hack'', ''Teacher'')', v_target_biz);
  EXCEPTION WHEN insufficient_privilege THEN
    v_err_caught := TRUE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff was not denied direct INSERT on public.staff';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    EXECUTE format('UPDATE public.staff SET name = ''Hacked'' WHERE id = %L', v_test_teacher_pauh);
  EXCEPTION WHEN insufficient_privilege THEN
    v_err_caught := TRUE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff was not denied direct UPDATE on public.staff';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    EXECUTE format('DELETE FROM public.staff WHERE id = %L', v_test_teacher_pauh);
  EXCEPTION WHEN insufficient_privilege THEN
    v_err_caught := TRUE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff was not denied direct DELETE on public.staff';
  END IF;

  -- Verify get_teachers_with_salary, save_teacher_with_salary, delete_teacher raise specific authorization exception (SQLSTATE P0001)
  v_err_caught := FALSE;
  BEGIN
    PERFORM * FROM public.get_teachers_with_salary(v_target_biz);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B2): Unexpected exception from get_teachers_with_salary: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): get_teachers_with_salary did not reject Pauh Jaya Staff';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    PERFORM public.save_teacher_with_salary(v_target_biz, 'Unauthorized', 'Teacher', '012', 'Monthly', 1000, NULL, NULL, v_pauh_branch_id);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B2): Unexpected exception from save_teacher_with_salary: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): save_teacher_with_salary did not reject Pauh Jaya Staff';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    PERFORM public.delete_teacher(v_target_biz, v_test_teacher_pauh);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B2): Unexpected exception from delete_teacher: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): delete_teacher did not reject Pauh Jaya Staff';
  END IF;

  -- Verify direct SELECT and INSERT on public.staff_payments are blocked by RLS (SQLSTATE 42501)
  SELECT COUNT(*) INTO v_count FROM public.staff_payments WHERE business_id = v_target_biz;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff could read % rows from public.staff_payments', v_count;
  END IF;

  v_err_caught := FALSE;
  BEGIN
    INSERT INTO public.staff_payments (business_id, branch_id, staff_id, amount, month, year, date)
    VALUES (v_target_biz, v_pauh_branch_id, v_test_teacher_pauh, 500, 'TestMonth', 2099, CURRENT_DATE);
  EXCEPTION WHEN insufficient_privilege THEN
    v_err_caught := TRUE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff was not blocked from inserting into public.staff_payments';
  END IF;

  -- Verify branch-scoped directory SELECT on public.staff works for Pauh Jaya Staff
  -- (sees Pauh Jaya teachers ONLY; Kelisa Emas teacher is hidden!)
  SELECT COUNT(*) INTO v_count
  FROM public.staff
  WHERE business_id = v_target_biz
    AND id IN (v_test_teacher_pauh, v_test_teacher_noclass);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff could not read own branch teacher directory columns (id, name, branch_id)';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.staff
  WHERE business_id = v_target_biz
    AND id = v_test_teacher_kelisa;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff was able to read Kelisa Emas teacher directory row!';
  END IF;

  -- Verify Pauh Jaya Staff gets ONLY Pauh Jaya payroll aggregate (3700) whether passing NULL or Pauh Jaya branch_id
  IF public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, NULL) <> 3700 THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff should receive branch-locked aggregate 3700 when passing NULL';
  END IF;
  IF public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_pauh_branch_id) <> 3700 THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff should receive 3700 when passing Pauh Jaya branch_id';
  END IF;

  -- Verify Pauh Jaya Staff is DENIED when requesting Kelisa Emas branch_id
  v_err_caught := FALSE;
  BEGIN
    PERFORM public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_kelisa_branch_id);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B2): Unexpected exception from get_staff_expenses_summary: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B2): Pauh Jaya Staff was not blocked from querying Kelisa Emas payroll aggregate';
  END IF;

  -- ----------------------------------------------------------
  -- B3. Simulate Kelisa Emas Staff (Restricted Branch Staff)
  -- ----------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_kelisa_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_kelisa_uid::text, 'role', 'authenticated')::text, true);

  IF current_user <> 'authenticated' OR auth.uid() <> v_kelisa_uid THEN
    RAISE EXCEPTION 'ROLE/JWT FAILURE (B3): user=%, uid=%', current_user, auth.uid();
  END IF;

  IF public.is_salary_authorized(v_target_biz) THEN
    RAISE EXCEPTION 'TEST FAILURE (B3): Kelisa Emas Staff must NOT be salary authorized';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.staff_payments WHERE business_id = v_target_biz;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILURE (B3): Kelisa Emas Staff could read % rows from public.staff_payments', v_count;
  END IF;

  -- Verify Kelisa Emas Staff gets ONLY Kelisa Emas payroll aggregate (1800)
  IF public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, NULL) <> 1800 THEN
    RAISE EXCEPTION 'TEST FAILURE (B3): Kelisa Emas Staff should receive branch-locked aggregate 1800';
  END IF;
  IF public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_kelisa_branch_id) <> 1800 THEN
    RAISE EXCEPTION 'TEST FAILURE (B3): Kelisa Emas Staff should receive 1800 for Kelisa Emas branch_id';
  END IF;

  -- Verify Kelisa Emas Staff is DENIED when requesting Pauh Jaya branch_id
  v_err_caught := FALSE;
  BEGIN
    PERFORM public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_pauh_branch_id);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B3): Unexpected exception: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B3): Kelisa Emas Staff was not blocked from querying Pauh Jaya payroll aggregate';
  END IF;

  -- ----------------------------------------------------------
  -- B4. Simulate Non-Hana Creator, Unassigned Staff & Outsider
  -- ----------------------------------------------------------
  -- 4a. Non-Hana Creator: Denied individual salaries & payments, allowed business aggregate per access matrix
  PERFORM set_config('request.jwt.claim.sub', v_other_creator_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other_creator_uid::text, 'role', 'authenticated')::text, true);

  IF public.is_salary_authorized(v_target_biz) THEN
    RAISE EXCEPTION 'TEST FAILURE (B4a): Non-Hana Creator must NOT be salary authorized';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    PERFORM * FROM public.get_teachers_with_salary(v_target_biz);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B4a): Unexpected exception: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B4a): Non-Hana Creator was not rejected by get_teachers_with_salary';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.staff_payments WHERE business_id = v_target_biz;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILURE (B4a): Non-Hana Creator could read % rows from public.staff_payments', v_count;
  END IF;

  IF public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, NULL) <> 5500 THEN
    RAISE EXCEPTION 'TEST FAILURE (B4a): Authorized business Creator should still receive scalar payroll aggregate';
  END IF;

  -- 4b. Unassigned Staff in multi-branch business: Fail-closed on payroll aggregate
  PERFORM set_config('request.jwt.claim.sub', v_unassigned_staff_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unassigned_staff_uid::text, 'role', 'authenticated')::text, true);

  v_err_caught := FALSE;
  BEGIN
    PERFORM public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, NULL);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B4b): Unexpected exception: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B4b): Unassigned Staff was not rejected by get_staff_expenses_summary';
  END IF;

  -- 4c. Outsider (non-member): Fail-closed on payroll aggregate
  PERFORM set_config('request.jwt.claim.sub', v_outsider_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider_uid::text, 'role', 'authenticated')::text, true);

  v_err_caught := FALSE;
  BEGIN
    PERFORM public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, NULL);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B4c): Unexpected exception: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B4c): Non-member user was not rejected by get_staff_expenses_summary';
  END IF;

  -- 4d. ReadOnly role aggregate policy (matches 07_multi_branch.sql Case 4):
  --     (1) Branch-assigned ReadOnly sees own branch aggregate only, rejected on other branch & individual salaries
  PERFORM set_config('request.jwt.claim.sub', v_readonly_pauh_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_readonly_pauh_uid::text, 'role', 'authenticated')::text, true);

  SELECT public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_pauh_branch_id) INTO v_summary_total;
  IF v_summary_total <> 3700 THEN
    RAISE EXCEPTION 'TEST FAILURE (B4d-1): Branch-assigned ReadOnly Pauh Jaya payroll aggregate expected 3700, got %', v_summary_total;
  END IF;

  SELECT public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, NULL) INTO v_summary_total;
  IF v_summary_total <> 3700 THEN
    RAISE EXCEPTION 'TEST FAILURE (B4d-2): Branch-assigned ReadOnly NULL branch_id must scope to Pauh Jaya (3700), got %', v_summary_total;
  END IF;

  v_err_caught := FALSE;
  BEGIN
    PERFORM public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_kelisa_branch_id);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B4d-3): Unexpected exception on cross-branch ReadOnly: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B4d-3): Branch-assigned ReadOnly was not rejected on Kelisa Emas branch';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    PERFORM * FROM public.get_teachers_with_salary(v_target_biz);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B4d-4): Unexpected exception on ReadOnly get_teachers_with_salary: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B4d-4): Branch-assigned ReadOnly was not rejected by get_teachers_with_salary';
  END IF;

  --     (2) Unassigned ReadOnly (branch_id IS NULL) sees business-wide scalar aggregate only, zero individual salary access
  PERFORM set_config('request.jwt.claim.sub', v_readonly_biz_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_readonly_biz_uid::text, 'role', 'authenticated')::text, true);

  SELECT public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, NULL) INTO v_summary_total;
  IF v_summary_total <> 5500 THEN
    RAISE EXCEPTION 'TEST FAILURE (B4d-5): Business-wide ReadOnly aggregate expected 5500, got %', v_summary_total;
  END IF;

  SELECT public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_kelisa_branch_id) INTO v_summary_total;
  IF v_summary_total <> 1800 THEN
    RAISE EXCEPTION 'TEST FAILURE (B4d-6): Business-wide ReadOnly Kelisa Emas aggregate expected 1800, got %', v_summary_total;
  END IF;

  v_err_caught := FALSE;
  BEGIN
    PERFORM * FROM public.get_teachers_with_salary(v_target_biz);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B4d-7): Unexpected exception on business-wide ReadOnly get_teachers_with_salary: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B4d-7): Business-wide ReadOnly was not rejected by get_teachers_with_salary';
  END IF;

  -- ----------------------------------------------------------
  -- B5. Historical Payroll Allocation Invariants
  --     - Class assignment removal does NOT alter branch payroll
  --     - Teacher branch transfer does NOT move historical payroll between branches
  --     - Soft-deleting a teacher preserves historical payroll in branch & consolidated totals
  --     - Consolidated payroll reconciles with sum of branch payrolls
  -- ----------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);

  -- 5a. Remove class assignment from v_test_teacher_pauh (groups.teacher_id = NULL)
  UPDATE public.groups
  SET teacher_id = NULL
  WHERE id = v_test_class_pauh;

  IF public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_pauh_branch_id) <> 3700 THEN
    RAISE EXCEPTION 'TEST FAILURE (B5a): Removing teacher class assignment altered historical Pauh Jaya payroll!';
  END IF;

  -- 5b. Transfer v_test_teacher_pauh from Pauh Jaya to Kelisa Emas via save_teacher_with_salary
  PERFORM public.save_teacher_with_salary(
    v_target_biz, 'Test Teacher Pauh Jaya (Transferred)', 'Science Teacher', '0120000001',
    'Monthly', 2200, 'Transferred to KE', v_test_teacher_pauh, v_kelisa_branch_id
  );

  -- Record a new payment in 'NextMonth' 2099 after the transfer (auto-assigned to Kelisa Emas)
  INSERT INTO public.staff_payments (business_id, staff_id, amount, month, year, date, notes)
  VALUES (v_target_biz, v_test_teacher_pauh, 2200, 'NextMonth', 2099, CURRENT_DATE, 'Post-transfer payment KE')
  RETURNING id INTO v_test_payment_transfer;

  -- Historical 'TestMonth' 2099 MUST remain 3700 in Pauh Jaya and 1800 in Kelisa Emas!
  IF public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_pauh_branch_id) <> 3700 THEN
    RAISE EXCEPTION 'TEST FAILURE (B5b): Teacher branch transfer moved historical TestMonth payroll out of Pauh Jaya!';
  END IF;
  IF public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_kelisa_branch_id) <> 1800 THEN
    RAISE EXCEPTION 'TEST FAILURE (B5b): Teacher branch transfer moved historical TestMonth payroll into Kelisa Emas!';
  END IF;

  -- Future 'NextMonth' 2099 payment MUST belong to Kelisa Emas (2200) and NOT Pauh Jaya (0)
  IF public.get_staff_expenses_summary(v_target_biz, 'NextMonth', 2099, v_pauh_branch_id) <> 0 THEN
    RAISE EXCEPTION 'TEST FAILURE (B5b): Post-transfer NextMonth payment was wrongly attributed to Pauh Jaya!';
  END IF;
  IF public.get_staff_expenses_summary(v_target_biz, 'NextMonth', 2099, v_kelisa_branch_id) <> 2200 THEN
    RAISE EXCEPTION 'TEST FAILURE (B5b): Post-transfer NextMonth payment was not attributed to Kelisa Emas!';
  END IF;

  -- 5c. Soft-delete v_test_teacher_kelisa via delete_teacher
  PERFORM public.delete_teacher(v_target_biz, v_test_teacher_kelisa);

  -- Soft-deleted teacher is hidden from active directory and get_teachers_with_salary
  SELECT COUNT(*) INTO v_count
  FROM public.get_teachers_with_salary(v_target_biz)
  WHERE id = v_test_teacher_kelisa;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILURE (B5c): Soft-deleted teacher still returned by get_teachers_with_salary';
  END IF;

  -- Active class MUST be unassigned (teacher_id IS NULL)
  SELECT COUNT(*) INTO v_count
  FROM public.groups
  WHERE id = v_test_class_kelisa
    AND teacher_id IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B5c-1): Active class was not unassigned by delete_teacher';
  END IF;

  -- Inactive historical class MUST preserve teacher_id
  SELECT COUNT(*) INTO v_count
  FROM public.groups
  WHERE id = v_test_class_kelisa_inactive
    AND teacher_id = v_test_teacher_kelisa;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B5c-2): Inactive historical class lost teacher_id after delete_teacher';
  END IF;

  -- Soft-deleted historical class MUST preserve teacher_id
  SELECT COUNT(*) INTO v_count
  FROM public.groups
  WHERE id = v_test_class_kelisa_softdel
    AND teacher_id = v_test_teacher_kelisa;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B5c-3): Soft-deleted historical class lost teacher_id after delete_teacher';
  END IF;

  -- Historical payroll audit retains historical branch evidence after delete_teacher
  SELECT COUNT(*) INTO v_count
  FROM public.get_historical_payroll_audit(v_target_biz) a
  WHERE a.payment_id = v_test_payment_kelisa
    AND a.all_history_branch_count = 2;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B5c-4): get_historical_payroll_audit lost historical branch evidence after delete_teacher';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.staff
  WHERE id = v_test_teacher_kelisa;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILURE (B5c): Soft-deleted teacher still visible via public.staff SELECT policy';
  END IF;

  -- Historical payment for soft-deleted teacher MUST remain included in Kelisa Emas (1800) and Consolidated (5500)
  v_sum_pauh := public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_pauh_branch_id);
  v_sum_kelisa := public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, v_kelisa_branch_id);
  v_sum := public.get_staff_expenses_summary(v_target_biz, 'TestMonth', 2099, NULL);

  IF v_sum_kelisa <> 1800 OR v_sum_pauh <> 3700 OR v_sum <> 5500 OR v_sum <> (v_sum_pauh + v_sum_kelisa) THEN
    RAISE EXCEPTION 'TEST FAILURE (B5c): Soft-deleting teacher altered historical payroll totals (PJ=%, KE=%, Total=%)',
      v_sum_pauh, v_sum_kelisa, v_sum;
  END IF;

  -- 5d. Historical attribution protection on ordinary UPDATE & cross-tenant branch rejection
  v_err_caught := FALSE;
  BEGIN
    UPDATE public.staff_payments
    SET branch_id = v_kelisa_branch_id
    WHERE id = v_test_payment_pauh;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Historical attribution protected%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B5d): Unexpected exception on ordinary payment branch UPDATE: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B5d): Ordinary UPDATE on staff_payments was able to silently alter historical branch_id!';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    INSERT INTO public.staff_payments (business_id, branch_id, staff_id, amount, month, year, date)
    VALUES (v_target_biz, '22222222-2222-4222-8222-222222222299', v_test_teacher_pauh, 500, 'TestMonth', 2099, CURRENT_DATE);
  EXCEPTION
    WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Inactive branch violation%' THEN
        v_err_caught := TRUE;
      ELSE
        RAISE EXCEPTION 'TEST FAILURE (B5d): Unexpected exception on cross-tenant branch_id: [%] %', v_sqlstate, v_err_msg;
      END IF;
    WHEN foreign_key_violation THEN
      v_err_caught := TRUE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B5d): Cross-tenant branch_id was not rejected on staff_payments INSERT';
  END IF;

  -- ----------------------------------------------------------
  -- B6. Branch Expense Isolation on public.expenses
  -- ----------------------------------------------------------
  -- 6a. As Pauh Jaya Staff: Insert Pauh Jaya expense (auto-branch trigger) & verify cross-branch block
  PERFORM set_config('request.jwt.claim.sub', v_pauh_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pauh_uid::text, 'role', 'authenticated')::text, true);

  INSERT INTO public.expenses (business_id, category, description, amount, date, notes)
  VALUES (v_target_biz, 'Utilities', 'Test PJ Electricity', 320, '2099-01-15', 'Test PJ Electricity')
  RETURNING id INTO v_test_expense_pauh;

  -- Verify trigger populated branch_id = v_pauh_branch_id
  SELECT COUNT(*) INTO v_count
  FROM public.expenses
  WHERE id = v_test_expense_pauh AND branch_id = v_pauh_branch_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B6a): trg_enforce_expense_branch did not auto-populate Pauh Jaya branch_id';
  END IF;

  -- Verify Pauh Jaya Staff cannot insert an expense into Kelisa Emas (SQLSTATE 42501 RLS violation)
  v_err_caught := FALSE;
  BEGIN
    INSERT INTO public.expenses (business_id, branch_id, category, description, amount, date, notes)
    VALUES (v_target_biz, v_kelisa_branch_id, 'Utilities', 'Cross-branch hack', 999, '2099-01-15', 'Cross-branch hack');
  EXCEPTION WHEN insufficient_privilege THEN
    v_err_caught := TRUE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B6a): Pauh Jaya Staff was not blocked from inserting Kelisa Emas expense';
  END IF;

  -- 6b. As Kelisa Emas Staff: Insert Kelisa Emas expense & verify isolation
  PERFORM set_config('request.jwt.claim.sub', v_kelisa_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_kelisa_uid::text, 'role', 'authenticated')::text, true);

  INSERT INTO public.expenses (business_id, branch_id, category, description, amount, date, notes)
  VALUES (v_target_biz, v_kelisa_branch_id, 'Supplies', 'Test KE Supplies', 450, '2099-01-16', 'Test KE Supplies')
  RETURNING id INTO v_test_expense_kelisa;

  -- Kelisa Emas Staff sees ONLY Kelisa Emas expenses (0 Pauh Jaya rows)
  SELECT COUNT(*) INTO v_count
  FROM public.expenses
  WHERE business_id = v_target_biz AND branch_id = v_pauh_branch_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILURE (B6b): Kelisa Emas Staff could read % Pauh Jaya expenses', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.expenses
  WHERE id = v_test_expense_kelisa AND branch_id = v_kelisa_branch_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B6b): Kelisa Emas Staff could not read own branch expense';
  END IF;

  -- 6c. As Pauh Jaya Staff: Verify 0 Kelisa Emas expenses visible & cannot reassign branch_id
  PERFORM set_config('request.jwt.claim.sub', v_pauh_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pauh_uid::text, 'role', 'authenticated')::text, true);

  SELECT COUNT(*) INTO v_count
  FROM public.expenses
  WHERE business_id = v_target_biz AND branch_id = v_kelisa_branch_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILURE (B6c): Pauh Jaya Staff could read % Kelisa Emas expenses', v_count;
  END IF;

  v_err_caught := FALSE;
  BEGIN
    UPDATE public.expenses SET branch_id = v_kelisa_branch_id WHERE id = v_test_expense_pauh;
  EXCEPTION
    WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Historical attribution protected%' THEN
        v_err_caught := TRUE;
      ELSE
        RAISE EXCEPTION 'TEST FAILURE (B6c): Unexpected exception: [%] %', v_sqlstate, v_err_msg;
      END IF;
    WHEN insufficient_privilege THEN
      v_err_caught := TRUE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B6c): Pauh Jaya Staff was not blocked from changing expense branch_id';
  END IF;

  -- 6d. As Puan Hana: Sees both Pauh Jaya and Kelisa Emas expenses
  PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);

  SELECT COUNT(*) INTO v_count
  FROM public.expenses
  WHERE id IN (v_test_expense_pauh, v_test_expense_kelisa);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILURE (B6d): Puan Hana could not view both branch expenses (got %)', v_count;
  END IF;

  -- ----------------------------------------------------------
  -- B7. Unmapped Historical Payroll Reconciliation, Pre-Migration
  --     Branch Transfer Detection & Explicit Reconciliation Rule:
  --     Consolidated Payroll = Pauh Jaya Payroll + Kelisa Emas Payroll + Unmapped Payroll
  -- ----------------------------------------------------------
  -- 7a. Verify unauthorized users (Pauh Jaya Staff, Kelisa Emas Staff, Non-Hana Creator)
  --     are strictly denied access to get_payroll_reconciliation_summary,
  --     get_historical_payroll_audit, and assign_staff_payment_branch.
  PERFORM set_config('request.jwt.claim.sub', v_pauh_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pauh_uid::text, 'role', 'authenticated')::text, true);

  v_err_caught := FALSE;
  BEGIN
    PERFORM * FROM public.get_payroll_reconciliation_summary(v_target_biz, 'October', 2026);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B7a): Unexpected exception: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B7a): Pauh Jaya Staff was not blocked from get_payroll_reconciliation_summary';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    PERFORM * FROM public.get_historical_payroll_audit(v_target_biz);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B7a): Unexpected exception: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B7a): Pauh Jaya Staff was not blocked from get_historical_payroll_audit';
  END IF;

  v_err_caught := FALSE;
  BEGIN
    PERFORM public.assign_staff_payment_branch(v_target_biz, v_test_payment_pauh, v_kelisa_branch_id);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B7a): Unexpected exception: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B7a): Pauh Jaya Staff was not blocked from assign_staff_payment_branch';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_other_creator_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other_creator_uid::text, 'role', 'authenticated')::text, true);

  v_err_caught := FALSE;
  BEGIN
    PERFORM * FROM public.get_payroll_reconciliation_summary(v_target_biz, 'October', 2026);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    IF v_sqlstate = 'P0001' AND v_err_msg ILIKE '%Access denied%' THEN
      v_err_caught := TRUE;
    ELSE
      RAISE EXCEPTION 'TEST FAILURE (B7a): Unexpected exception: [%] %', v_sqlstate, v_err_msg;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST FAILURE (B7a): Non-Hana Creator was not blocked from get_payroll_reconciliation_summary';
  END IF;

  -- 7b. Switch back to Puan Hana and verify the explicit reconciliation rule on ReconMonth 2099
  --     Required scenario: Pauh Jaya = 3,700, Kelisa Emas = 1,800, Unmapped = 500, Consolidated = 6,000
  PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);

  INSERT INTO public.staff_payments (business_id, branch_id, staff_id, amount, month, year, date, notes)
  VALUES
    (v_target_biz, v_pauh_branch_id, v_test_teacher_pauh, 3700, 'ReconMonth', 2099, CURRENT_DATE, 'Recon PJ 3700'),
    (v_target_biz, v_kelisa_branch_id, v_test_teacher_noclass, 1800, 'ReconMonth', 2099, CURRENT_DATE, 'Recon KE 1800');

  SELECT COUNT(*) INTO v_count
  FROM public.get_payroll_reconciliation_summary(v_target_biz, 'ReconMonth', 2099) r
  WHERE r.consolidated_payroll = 6000
    AND r.pauh_jaya_payroll = 3700
    AND r.kelisa_emas_payroll = 1800
    AND r.unmapped_payroll = 500
    AND r.consolidated_payroll = (r.pauh_jaya_payroll + r.kelisa_emas_payroll + r.unmapped_payroll)
    AND r.is_reconciled = FALSE;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B7b): get_payroll_reconciliation_summary did not return 6000 = 3700 + 1800 + 500 for ReconMonth 2099';
  END IF;

  -- Verify Branch Staff exclude unmapped RM 500 in ReconMonth 2099
  PERFORM set_config('request.jwt.claim.sub', v_pauh_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pauh_uid::text, 'role', 'authenticated')::text, true);
  IF public.get_staff_expenses_summary(v_target_biz, 'ReconMonth', 2099, NULL) <> 3700 THEN
    RAISE EXCEPTION 'TEST FAILURE (B7b): Pauh Jaya Staff ReconMonth 2099 did not exclude unmapped RM 500';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_kelisa_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_kelisa_uid::text, 'role', 'authenticated')::text, true);
  IF public.get_staff_expenses_summary(v_target_biz, 'ReconMonth', 2099, NULL) <> 1800 THEN
    RAISE EXCEPTION 'TEST FAILURE (B7b): Kelisa Emas Staff ReconMonth 2099 did not exclude unmapped RM 500';
  END IF;

  -- Switch back to Puan Hana and reconcile the unmapped RM 500 payment to Pauh Jaya
  PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);

  PERFORM public.assign_staff_payment_branch(v_target_biz, v_unmapped_500_id, v_pauh_branch_id);

  SELECT COUNT(*) INTO v_count
  FROM public.get_payroll_reconciliation_summary(v_target_biz, 'ReconMonth', 2099) r
  WHERE r.consolidated_payroll = 6000
    AND r.pauh_jaya_payroll = 4200
    AND r.kelisa_emas_payroll = 1800
    AND r.unmapped_payroll = 0
    AND r.is_reconciled = TRUE;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B7b): Reconciling RM 500 unmapped payment did not produce 6000 = 4200 + 1800 + 0';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.get_payroll_reconciliation_summary(v_target_biz, 'TestMonth', 2099) r
  WHERE r.consolidated_payroll = 5500
    AND r.pauh_jaya_payroll = 3700
    AND r.kelisa_emas_payroll = 1800
    AND r.unmapped_payroll = 0
    AND r.consolidated_payroll = (r.pauh_jaya_payroll + r.kelisa_emas_payroll + r.unmapped_payroll)
    AND r.is_reconciled = TRUE;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B7b): get_payroll_reconciliation_summary did not return expected reconciled totals for TestMonth 2099';
  END IF;

  -- 7c. Verify Puan Hana can reassign/reconcile a payment's branch via assign_staff_payment_branch
  PERFORM public.assign_staff_payment_branch(v_target_biz, v_test_payment_noclass, v_kelisa_branch_id);

  SELECT COUNT(*) INTO v_count
  FROM public.get_payroll_reconciliation_summary(v_target_biz, 'TestMonth', 2099) r
  WHERE r.consolidated_payroll = 5500
    AND r.pauh_jaya_payroll = 2200
    AND r.kelisa_emas_payroll = 3300
    AND r.unmapped_payroll = 0
    AND r.consolidated_payroll = (r.pauh_jaya_payroll + r.kelisa_emas_payroll + r.unmapped_payroll);

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B7c): assign_staff_payment_branch did not update branch allocation accurately';
  END IF;

  -- 7d. Zero-payments month/year reconciliation & month/year filtering check
  SELECT COUNT(*) INTO v_count
  FROM public.get_payroll_reconciliation_summary(v_target_biz, 'EmptyMonth', 2099) r
  WHERE r.consolidated_payroll = 0
    AND r.pauh_jaya_payroll = 0
    AND r.kelisa_emas_payroll = 0
    AND r.unmapped_payroll = 0
    AND r.unexpected_branch_payroll = 0
    AND r.unexpected_branch_count = 0
    AND r.unmapped_payment_count = 0
    AND r.is_reconciled = TRUE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B7d-1): Zero-payments reconciliation check failed for EmptyMonth 2099';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.get_payroll_reconciliation_summary(v_target_biz, 'NextMonth', 2099) r
  WHERE r.consolidated_payroll = 2200
    AND r.pauh_jaya_payroll = 0
    AND r.kelisa_emas_payroll = 2200
    AND r.unmapped_payroll = 0
    AND r.is_reconciled = TRUE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B7d-2): Month/year filtering leaked TestMonth payments into NextMonth 2099';
  END IF;

  -- 7e. Incomplete class history / pre-migration unmapped teacher retains staff.branch_id IS NULL
  SELECT COUNT(*) INTO v_count
  FROM public.staff
  WHERE id = '55555555-5555-4555-8555-555555555599'
    AND branch_id IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B7e): Teacher with incomplete class history was unexpectedly assigned staff.branch_id';
  END IF;

  -- ----------------------------------------------------------
  -- B8. Salary-Category Expenses Privacy & Aggregate Parity (Authenticated Role)
  -- ----------------------------------------------------------
  RESET ROLE;
  INSERT INTO public.expenses (id, business_id, branch_id, date, category, description, amount)
  VALUES
    ('88888888-8888-4888-8888-888888888801', v_target_biz, v_pauh_branch_id, '2099-11-10', 'Rental', 'Pauh Jaya Rent', 1400),
    ('88888888-8888-4888-8888-888888888802', v_target_biz, v_pauh_branch_id, '2099-11-15', 'Salary', 'Confidential Teacher Bonus PJ', 950),
    ('88888888-8888-4888-8888-888888888803', v_target_biz, v_kelisa_branch_id, '2099-11-12', 'Utilities', 'Kelisa Electric', 450),
    ('88888888-8888-4888-8888-888888888804', v_target_biz, v_kelisa_branch_id, '2099-11-18', 'Salary', 'Confidential Teacher Bonus KE', 600);

  -- B8a. Pauh Jaya Staff sees ONLY Pauh Jaya general expense (1400), ZERO Salary rows
  PERFORM set_config('request.jwt.claim.sub', v_pauh_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  SELECT COUNT(*) INTO v_count
  FROM public.expenses
  WHERE business_id = v_target_biz
    AND date >= '2099-11-01' AND date <= '2099-11-30';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B8a-1): Pauh Jaya Staff should see exactly 1 general expense row, saw %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.expenses
  WHERE business_id = v_target_biz
    AND public.is_salary_expense_category(category);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SECURITY FAILURE (B8a-2): Pauh Jaya Staff saw % Salary-category expense row(s)', v_count;
  END IF;

  -- Pauh Jaya Staff cannot INSERT Salary-category expense
  BEGIN
    INSERT INTO public.expenses (business_id, branch_id, date, category, description, amount)
    VALUES (v_target_biz, v_pauh_branch_id, '2099-11-20', 'Salary', 'Unauthorized Salary Insert', 500);
    RAISE EXCEPTION 'SECURITY FAILURE (B8a-3): Pauh Jaya Staff was allowed to insert Salary-category expense';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- Pauh Jaya Staff cannot UPDATE general expense to Salary category
  BEGIN
    UPDATE public.expenses
    SET category = 'Salary'
    WHERE id = '88888888-8888-4888-8888-888888888801';
    RAISE EXCEPTION 'SECURITY FAILURE (B8a-4): Pauh Jaya Staff was allowed to reclassify expense to Salary';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- Pauh Jaya Staff cannot DELETE Salary-category expense
  DELETE FROM public.expenses WHERE id = '88888888-8888-4888-8888-888888888802';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SECURITY FAILURE (B8a-5): Pauh Jaya Staff deleted Salary-category expense';
  END IF;

  -- Non-salary aggregate RPCs exclude Salary-category expenses to prevent double-counting
  IF public.get_expenses_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, NULL) <> 1400 THEN
    RAISE EXCEPTION 'TEST FAILURE (B8a-6): get_expenses_summary for Pauh Jaya Staff did not equal 1400 (non-salary only)';
  END IF;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_summary_total
  FROM public.get_monthly_expenses_summary(v_target_biz, 2099, NULL)
  WHERE month_num = 11;
  IF v_summary_total <> 1400 THEN
    RAISE EXCEPTION 'TEST FAILURE (B8a-7): get_monthly_expenses_summary Nov 2099 for Pauh Jaya Staff expected 1400, got %', v_summary_total;
  END IF;

  -- Cross-branch aggregate still fails closed for Pauh Jaya Staff
  DECLARE
    v_rejected BOOLEAN := false;
    v_sqlstate TEXT;
    v_errm TEXT;
  BEGIN
    BEGIN
      PERFORM public.get_expenses_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, v_kelisa_branch_id);
    EXCEPTION
      WHEN insufficient_privilege OR raise_exception THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errm = MESSAGE_TEXT;
        IF v_sqlstate = '42501' OR (v_sqlstate = 'P0001' AND v_errm ILIKE '%Access denied%') THEN
          v_rejected := true;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'SECURITY FAILURE (B8a-8): Pauh Jaya Staff accessed Kelisa Emas expenses aggregate';
    END IF;
  END;

  -- Positive control (B8a-8b): Allowed own-branch aggregate must succeed without triggering v_rejected
  DECLARE
    v_rejected BOOLEAN := false;
    v_sqlstate TEXT;
    v_errm TEXT;
    v_own_total NUMERIC := -1;
  BEGIN
    BEGIN
      v_own_total := public.get_expenses_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, v_pauh_branch_id);
    EXCEPTION
      WHEN insufficient_privilege OR raise_exception THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errm = MESSAGE_TEXT;
        IF v_sqlstate = '42501' OR (v_sqlstate = 'P0001' AND v_errm ILIKE '%Access denied%') THEN
          v_rejected := true;
        END IF;
    END;
    IF v_rejected OR v_own_total <> 1400 THEN
      RAISE EXCEPTION 'REGRESSION FAILURE (B8a-8b): Allowed own-branch get_expenses_summary failed or triggered rejection (rejected=%, total=%)', v_rejected, v_own_total;
    END IF;
  END;

  -- B8b. Puan Hana retains full visibility of general + Salary-category expenses and consolidated/branch aggregates
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  SELECT COUNT(*) INTO v_count
  FROM public.expenses
  WHERE business_id = v_target_biz
    AND date >= '2099-11-01' AND date <= '2099-11-30';
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'TEST FAILURE (B8b-1): Puan Hana expected 4 Nov 2099 expense rows (general + Salary), saw %', v_count;
  END IF;

  IF public.get_expenses_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, NULL) <> 1850 THEN
    RAISE EXCEPTION 'TEST FAILURE (B8b-2): Puan Hana consolidated get_expenses_summary expected 1850 (non-salary)';
  END IF;

  IF public.get_expenses_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, v_pauh_branch_id) <> 1400 THEN
    RAISE EXCEPTION 'TEST FAILURE (B8b-3): Puan Hana Pauh Jaya get_expenses_summary expected 1400 (non-salary)';
  END IF;

  IF public.get_expenses_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, v_kelisa_branch_id) <> 450 THEN
    RAISE EXCEPTION 'TEST FAILURE (B8b-4): Puan Hana Kelisa Emas get_expenses_summary expected 450 (non-salary)';
  END IF;

  -- ----------------------------------------------------------
  -- B9. Phase 2.5: Teacher Directory, Double-Counting Prevention &
  --     Dashboard/Reports Financial Consistency (Authenticated Role)
  -- ----------------------------------------------------------
  RESET ROLE;
  -- Seed dedicated active teachers for Phase 2.5 directory checks
  INSERT INTO public.staff (id, business_id, branch_id, name, role, salary_type, salary_amount)
  VALUES
    ('99999999-9999-4999-8999-999999999001', v_target_biz, v_pauh_branch_id, 'Nov 2099 Teacher PJ', 'Teacher', 'Monthly', 2000),
    ('99999999-9999-4999-8999-999999999002', v_target_biz, v_kelisa_branch_id, 'Nov 2099 Teacher KE', 'Teacher', 'Monthly', 2000),
    ('99999999-9999-4999-8999-999999999003', v_target_biz, NULL, 'Nov 2099 Teacher Unmapped', 'Teacher', 'Monthly', 500);

  -- Seed November 2099 payroll, matching Salary expense, standalone Salary expense,
  -- distinct payments, unmapped historical payment, and paid student collections
  INSERT INTO public.staff_payments (id, business_id, branch_id, staff_id, amount, date, month, year)
  VALUES
    ('99999999-9999-4999-8999-999999999101', v_target_biz, v_pauh_branch_id, '99999999-9999-4999-8999-999999999001', 2000, '2099-11-25', 'November', 2099),
    ('99999999-9999-4999-8999-999999999102', v_target_biz, v_kelisa_branch_id, '99999999-9999-4999-8999-999999999002', 1500, '2099-11-25', 'November', 2099),
    ('99999999-9999-4999-8999-999999999103', v_target_biz, v_kelisa_branch_id, '99999999-9999-4999-8999-999999999002', 500, '2099-11-25', 'November', 2099);

  -- Simulate a pre-migration unmapped historical payment (branch_id IS NULL)
  ALTER TABLE public.staff_payments DISABLE TRIGGER trg_enforce_staff_payment_branch;
  INSERT INTO public.staff_payments (id, business_id, branch_id, staff_id, amount, date, month, year)
  VALUES
    ('99999999-9999-4999-8999-999999999104', v_target_biz, NULL, '99999999-9999-4999-8999-999999999003', 500, '2099-11-25', 'November', 2099);
  ALTER TABLE public.staff_payments ENABLE TRIGGER trg_enforce_staff_payment_branch;

  -- Matching Salary expense row RM 2,000 in Pauh Jaya (must NOT double-count with 9101!)
  INSERT INTO public.expenses (id, business_id, branch_id, date, category, description, amount, staff_payment_id)
  VALUES
    ('88888888-8888-4888-8888-888888888805', v_target_biz, v_pauh_branch_id, '2099-11-25', 'Salary', 'Nov 2099 Teacher Salary PJ', 2000, '99999999-9999-4999-8999-999999999101');

  -- Seed test students for November 2099 paid student collections
  INSERT INTO public.customers (id, business_id, branch_id, name, monthly_fee)
  VALUES
    ('77777777-7777-4777-8777-777777777001', v_target_biz, v_pauh_branch_id, 'Nov 2099 Student PJ', 10000),
    ('77777777-7777-4777-8777-777777777002', v_target_biz, v_kelisa_branch_id, 'Nov 2099 Student KE', 8000);

  -- Paid student collections in November 2099 (PJ = 10,000, KE = 8,000)
  INSERT INTO public.payments (id, business_id, branch_id, customer_id, amount, payment_date, payment_method, month, year, status)
  VALUES
    ('77777777-7777-4777-8777-777777777101', v_target_biz, v_pauh_branch_id, '77777777-7777-4777-8777-777777777001', 10000, '2099-11-15', 'Cash', 'November', 2099, 'Paid'),
    ('77777777-7777-4777-8777-777777777102', v_target_biz, v_kelisa_branch_id, '77777777-7777-4777-8777-777777777002', 8000, '2099-11-15', 'Bank Transfer', 'November', 2099, 'Paid');

  -- B9a. Pauh Jaya Staff: teacher directory + single-counted payroll (2000, NOT 4000 or 4950)
  PERFORM set_config('request.jwt.claim.sub', v_pauh_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  SELECT COUNT(*) INTO v_count
  FROM public.get_staff_directory(v_target_biz) d
  WHERE d.id = '99999999-9999-4999-8999-999999999001';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B9a-1): Pauh Jaya Staff could not view Pauh Jaya teacher in get_staff_directory';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.get_staff_directory(v_target_biz) d
  WHERE d.id = '99999999-9999-4999-8999-999999999002';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SECURITY FAILURE (B9a-2): Pauh Jaya Staff saw Kelisa Emas teacher in get_staff_directory';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.get_financial_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, 'November', 2099, NULL) f
  WHERE f.collections = 10000
    AND f.non_salary_expenses = 1400
    AND f.teacher_payroll = 2000
    AND f.standalone_salary_expenses = 0
    AND f.unresolved_salary_expense_count = 1
    AND f.unresolved_salary_expense_amount = 950
    AND f.total_expenses = 3400
    AND f.net_profit = 6600
    AND f.is_reconciled = false;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B9a-3): Pauh Jaya get_financial_summary double-counted or mismatched (expected 10000/1400/2000/0/1/950/3400/6600/false)';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.get_monthly_financial_summary(v_target_biz, 2099, NULL) m
  WHERE m.month_num = 11
    AND m.non_salary_expenses = 1400
    AND m.teacher_payroll = 2000
    AND m.standalone_salary_expenses = 0
    AND m.unresolved_salary_expense_count = 1
    AND m.unresolved_salary_expense_amount = 950
    AND m.total_expenses = 3400
    AND m.is_reconciled = false;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B9a-4): Pauh Jaya get_monthly_financial_summary Nov 2099 did not match get_financial_summary';
  END IF;

  -- B9b. Kelisa Emas Staff: two distinct payments (1500+500=2000), excludes standalone Salary expense (600) and unmapped (500)
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_kelisa_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  SELECT COUNT(*) INTO v_count
  FROM public.get_staff_directory(v_target_biz) d
  WHERE d.id = '99999999-9999-4999-8999-999999999002';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B9b-1): Kelisa Emas Staff could not view Kelisa Emas teacher in get_staff_directory';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.get_financial_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, 'November', 2099, NULL) f
  WHERE f.collections = 8000
    AND f.non_salary_expenses = 450
    AND f.teacher_payroll = 2000
    AND f.standalone_salary_expenses = 0
    AND f.unresolved_salary_expense_count = 1
    AND f.unresolved_salary_expense_amount = 600
    AND f.total_expenses = 2450
    AND f.net_profit = 5550
    AND f.is_reconciled = false;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B9b-2): Kelisa Emas get_financial_summary mismatched (expected 8000/450/2000/0/1/600/2450/5550/false)';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.get_monthly_financial_summary(v_target_biz, 2099, NULL) m
  WHERE m.month_num = 11
    AND m.non_salary_expenses = 450
    AND m.teacher_payroll = 2000
    AND m.standalone_salary_expenses = 0
    AND m.unresolved_salary_expense_count = 1
    AND m.unresolved_salary_expense_amount = 600
    AND m.total_expenses = 2450
    AND m.is_reconciled = false;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B9b-3): Kelisa Emas get_monthly_financial_summary Nov 2099 did not match get_financial_summary';
  END IF;

  -- B9c. Generic Creator/Admin: can view safe directory, CANNOT call get_teachers_with_salary, sees consolidated aggregates
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_other_creator_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  SELECT COUNT(*) INTO v_count FROM public.get_staff_directory(v_target_biz);
  IF v_count < 2 THEN
    RAISE EXCEPTION 'TEST FAILURE (B9c-1): Generic Creator could not view staff directory';
  END IF;

  -- B9d. Puan Hana: consolidated includes PJ (2000) + KE (2000) + Unmapped (500) = 4500 payroll, 1850 non-salary, 6350 total, 11650 net profit
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  SELECT COUNT(*) INTO v_count
  FROM public.get_financial_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, 'November', 2099, NULL) f
  WHERE f.collections = 18000
    AND f.non_salary_expenses = 1850
    AND f.teacher_payroll = 4500
    AND f.total_expenses = 6350
    AND f.net_profit = 11650;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B9d-1): Puan Hana consolidated get_financial_summary mismatched (expected 18000/1850/4500/6350/11650)';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.get_monthly_financial_summary(v_target_biz, 2099, NULL) m
  WHERE m.month_num = 11
    AND m.non_salary_expenses = 1850
    AND m.teacher_payroll = 4500
    AND m.total_expenses = 6350;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B9d-2): Puan Hana consolidated get_monthly_financial_summary Nov 2099 did not match';
  END IF;

  -- Historical Salary expense rows preserved untouched (3 rows in 2099-11)
  SELECT COUNT(*) INTO v_count
  FROM public.expenses
  WHERE business_id = v_target_biz
    AND date >= '2099-11-01' AND date <= '2099-11-30'
    AND public.is_salary_expense_category(category);
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'TEST FAILURE (B9d-3): Expected 3 historical Salary expense rows preserved, found %', v_count;
  END IF;

  -- ----------------------------------------------------------
  -- B10. Phase 2.6 & 2.7: Unlinked Salary Expense Reconciliation,
  --      Strict Negative Assertions & Linked Payroll Delete Integrity
  -- ----------------------------------------------------------
  -- B10a. Staff & Generic Creator CANNOT call get_unresolved_salary_expenses or reconcile_salary_expense
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_pauh_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  DECLARE
    v_rejected BOOLEAN := false;
    v_sqlstate TEXT;
    v_errm TEXT;
  BEGIN
    BEGIN
      PERFORM * FROM public.get_unresolved_salary_expenses(v_target_biz, NULL);
    EXCEPTION
      WHEN insufficient_privilege OR raise_exception THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errm = MESSAGE_TEXT;
        IF v_sqlstate = '42501' OR (v_sqlstate = 'P0001' AND v_errm ILIKE '%Access denied%') THEN
          v_rejected := true;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'SECURITY FAILURE (B10a-1): Pauh Jaya Staff called get_unresolved_salary_expenses without access denial';
    END IF;
  END;

  DECLARE
    v_rejected BOOLEAN := false;
    v_sqlstate TEXT;
    v_errm TEXT;
  BEGIN
    BEGIN
      PERFORM * FROM public.reconcile_salary_expense(v_target_biz, '88888888-8888-4888-8888-888888888802', 'standalone', NULL);
    EXCEPTION
      WHEN insufficient_privilege OR raise_exception THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errm = MESSAGE_TEXT;
        IF v_sqlstate = '42501' OR (v_sqlstate = 'P0001' AND v_errm ILIKE '%Access denied%') THEN
          v_rejected := true;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'SECURITY FAILURE (B10a-2): Pauh Jaya Staff called reconcile_salary_expense without access denial';
    END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_other_creator_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  DECLARE
    v_rejected BOOLEAN := false;
    v_sqlstate TEXT;
    v_errm TEXT;
  BEGIN
    BEGIN
      PERFORM * FROM public.get_unresolved_salary_expenses(v_target_biz, NULL);
    EXCEPTION
      WHEN insufficient_privilege OR raise_exception THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errm = MESSAGE_TEXT;
        IF v_sqlstate = '42501' OR (v_sqlstate = 'P0001' AND v_errm ILIKE '%Access denied%') THEN
          v_rejected := true;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'SECURITY FAILURE (B10a-3): Generic Creator called get_unresolved_salary_expenses without access denial';
    END IF;
  END;

  DECLARE
    v_rejected BOOLEAN := false;
    v_sqlstate TEXT;
    v_errm TEXT;
  BEGIN
    BEGIN
      PERFORM * FROM public.reconcile_salary_expense(v_target_biz, '88888888-8888-4888-8888-888888888802', 'standalone', NULL);
    EXCEPTION
      WHEN insufficient_privilege OR raise_exception THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errm = MESSAGE_TEXT;
        IF v_sqlstate = '42501' OR (v_sqlstate = 'P0001' AND v_errm ILIKE '%Access denied%') THEN
          v_rejected := true;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'SECURITY FAILURE (B10a-4): Generic Creator called reconcile_salary_expense without access denial';
    END IF;
  END;

  -- B10b. Puan Hana sees 2 unresolved Salary expenses (PJ RM 950 + KE RM 600)
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  SELECT COUNT(*) INTO v_count FROM public.get_unresolved_salary_expenses(v_target_biz, NULL);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILURE (B10b-1): Expected 2 unresolved salary expenses for Puan Hana, got %', v_count;
  END IF;

  -- Prevent linking one staff_payment_id to a second expense row
  DECLARE
    v_rejected BOOLEAN := false;
    v_sqlstate TEXT;
    v_errm TEXT;
  BEGIN
    BEGIN
      PERFORM * FROM public.reconcile_salary_expense(
        v_target_biz,
        '88888888-8888-4888-8888-888888888802',
        'linked_duplicate',
        '99999999-9999-4999-8999-999999999101'
      );
    EXCEPTION
      WHEN unique_violation OR raise_exception THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errm = MESSAGE_TEXT;
        IF v_sqlstate = '23505' OR v_errm ILIKE '%already linked%' THEN
          v_rejected := true;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'INTEGRITY FAILURE (B10b-2): Allowed duplicate staff_payment_id link across two expenses';
    END IF;
  END;

  -- Prevent cross-branch link (PJ expense -> KE staff_payment)
  DECLARE
    v_rejected BOOLEAN := false;
    v_errm TEXT;
  BEGIN
    BEGIN
      PERFORM * FROM public.reconcile_salary_expense(
        v_target_biz,
        '88888888-8888-4888-8888-888888888802',
        'linked_duplicate',
        '99999999-9999-4999-8999-999999999102'
      );
    EXCEPTION
      WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_errm = MESSAGE_TEXT;
        IF v_errm ILIKE '%Branch mismatch%' THEN
          v_rejected := true;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'INTEGRITY FAILURE (B10b-3): Allowed cross-branch staff_payment_id link';
    END IF;
  END;

  -- Positive-control regression test: allowed reconcile_salary_expense must NOT trigger rejection
  DECLARE
    v_rejected BOOLEAN := false;
  BEGIN
    BEGIN
      PERFORM * FROM public.reconcile_salary_expense(
        v_target_biz,
        '88888888-8888-4888-8888-888888888804',
        'standalone',
        NULL
      );
    EXCEPTION
      WHEN insufficient_privilege OR unique_violation OR raise_exception OR check_violation OR foreign_key_violation THEN
        v_rejected := true;
    END;
    IF v_rejected THEN
      RAISE EXCEPTION 'REGRESSION FAILURE (B10b-4): Allowed reconcile_salary_expense(standalone) unexpectedly rejected';
    END IF;
  END;

  -- B10c. Scenario B: Reconcile KE RM 600 ('...8804') as 'standalone' -> KE Total Expenses = 450 + 2000 + 600 = 3050, is_reconciled = true
  -- Verify audit log entry recorded in activity_logs
  SELECT COUNT(*) INTO v_count
  FROM public.activity_logs
  WHERE business_id = v_target_biz
    AND module = 'expenses'
    AND action = 'reconcile_salary_expense'
    AND new_value->>'expense_id' = '88888888-8888-4888-8888-888888888804'
    AND new_value->>'salary_reconciliation_status' = 'standalone';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'AUDIT FAILURE (B10c-1): reconcile_salary_expense did not log to activity_logs';
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_kelisa_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  SELECT COUNT(*) INTO v_count
  FROM public.get_financial_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, 'November', 2099, NULL) f
  WHERE f.collections = 8000
    AND f.non_salary_expenses = 450
    AND f.teacher_payroll = 2000
    AND f.standalone_salary_expenses = 600
    AND f.unresolved_salary_expense_count = 0
    AND f.unresolved_salary_expense_amount = 0
    AND f.total_expenses = 3050
    AND f.net_profit = 4950
    AND f.is_reconciled = true;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B10c-2): Kelisa Emas confirmed standalone RM 600 not reflected accurately';
  END IF;

  -- Reconcile PJ RM 950 ('...8802') as 'standalone' -> Consolidated is_reconciled = true, standalone = 1550, total_expenses = 7900
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  PERFORM * FROM public.reconcile_salary_expense(
    v_target_biz,
    '88888888-8888-4888-8888-888888888802',
    'standalone',
    NULL
  );

  SELECT COUNT(*) INTO v_count
  FROM public.get_financial_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, 'November', 2099, NULL) f
  WHERE f.collections = 18000
    AND f.non_salary_expenses = 1850
    AND f.teacher_payroll = 4500
    AND f.standalone_salary_expenses = 1550
    AND f.unresolved_salary_expense_count = 0
    AND f.unresolved_salary_expense_amount = 0
    AND f.total_expenses = 7900
    AND f.net_profit = 10100
    AND f.is_reconciled = true;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B10c-3): Consolidated reconciled financial summary mismatched (expected 18000/1850/4500/1550/0/0/7900/10100/true)';
  END IF;

  -- B10d-1. Hard-deleting a linked staff_payments row MUST fail (ON DELETE RESTRICT / protect_linked_staff_payment_delete)
  DECLARE
    v_rejected BOOLEAN := false;
  BEGIN
    BEGIN
      DELETE FROM public.staff_payments
      WHERE id = '99999999-9999-4999-8999-999999999101';
    EXCEPTION
      WHEN foreign_key_violation OR SQLSTATE '23503' THEN
        v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'INTEGRITY FAILURE (B10d-1): Hard-deleting linked staff_payment was allowed';
    END IF;
  END;

  -- B10d-2. Soft-deleting a linked staff_payments row MUST unlink expense -> 'unresolved' + log audit + update summaries
  UPDATE public.staff_payments
  SET deleted_at = NOW(),
      deleted_by = v_hana_uid
  WHERE id = '99999999-9999-4999-8999-999999999101';

  SELECT COUNT(*) INTO v_count
  FROM public.expenses
  WHERE id = '88888888-8888-4888-8888-888888888805'
    AND staff_payment_id IS NULL
    AND salary_reconciliation_status = 'unresolved';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'INTEGRITY FAILURE (B10d-2a): Soft-deleting linked staff_payment did not unlink and revert expense to unresolved';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.activity_logs
  WHERE business_id = v_target_biz
    AND module = 'expenses'
    AND action = 'staff_payment_soft_deleted_unlink'
    AND new_value->>'expense_id' = '88888888-8888-4888-8888-888888888805'
    AND new_value->>'salary_reconciliation_status' = 'unresolved';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'AUDIT FAILURE (B10d-2b): Soft-deleting linked staff_payment did not log staff_payment_soft_deleted_unlink';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.get_financial_summary(v_target_biz, '2099-11-01'::date, '2099-11-30'::date, 'November', 2099, NULL) f
  WHERE f.teacher_payroll = 2500
    AND f.unresolved_salary_expense_count = 1
    AND f.unresolved_salary_expense_amount = 2000
    AND f.is_reconciled = false;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B10d-2c): get_financial_summary did not reflect unlinked unresolved expense after staff_payment soft-delete';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.get_monthly_financial_summary(v_target_biz, 2099, NULL) m
  WHERE m.month_name = 'November'
    AND m.teacher_payroll = 2500
    AND m.unresolved_salary_expense_count = 1
    AND m.unresolved_salary_expense_amount = 2000
    AND m.is_reconciled = false;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILURE (B10d-2d): get_monthly_financial_summary did not reflect unlinked unresolved expense after staff_payment soft-delete';
  END IF;

  -- Restore soft-deleted staff_payment and re-link '...8805' cleanly
  UPDATE public.staff_payments
  SET deleted_at = NULL,
      deleted_by = NULL
  WHERE id = '99999999-9999-4999-8999-999999999101';

  PERFORM * FROM public.reconcile_salary_expense(
    v_target_biz,
    '88888888-8888-4888-8888-888888888805',
    'linked_duplicate',
    '99999999-9999-4999-8999-999999999101'
  );

  -- B10e. Direct attempt to set linked_duplicate with NULL staff_payment_id MUST be rejected
  DECLARE
    v_rejected BOOLEAN := false;
  BEGIN
    BEGIN
      UPDATE public.expenses
      SET salary_reconciliation_status = 'linked_duplicate',
          staff_payment_id = NULL
      WHERE id = '88888888-8888-4888-8888-888888888802';
    EXCEPTION
      WHEN check_violation OR raise_exception THEN
        v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'INTEGRITY FAILURE (B10e): Allowed linked_duplicate status with NULL staff_payment_id';
    END IF;
  END;

  RAISE NOTICE 'PART B PASSED: True SET LOCAL ROLE authenticated runtime simulations verified for individual salary privacy, branch aggregate isolation, ReadOnly aggregate policy, active-only class unassignment, historical payroll audit retention, unmapped payroll reconciliation, branch expense isolation, Salary-category expense privacy, and Phase 2.6/2.7 salary expense reconciliation & soft-delete integrity.';
END $$;

-- ============================================================================
-- PART C: FAIL-CLOSED BRANCH ANOMALY TESTS FOR get_payroll_reconciliation_summary
-- (Tested inside SAVEPOINTs under superuser setup + SET LOCAL ROLE authenticated)
-- ============================================================================
RESET ROLE;

DO $$
DECLARE
  v_target_biz UUID := '978d2b0c-6a2b-4c28-9000-71dc23f96781';
  v_hana_uid UUID := 'd2b660bf-10d3-4d94-94ec-0b8f6e0908e6';
  v_kelisa_branch_id UUID := 'e4f61aac-9629-4be7-ae7e-8d9b462233a4';
  v_extra_branch_id UUID := gen_random_uuid();
  v_extra_teacher_id UUID := gen_random_uuid();
  v_extra_payment_id UUID := gen_random_uuid();
  v_count INT;
  v_sqlstate TEXT;
  v_err_msg TEXT;
  v_err_caught BOOLEAN;
BEGIN
  -- 8a-1. Third branch with ZERO payments: must fail closed (requires exactly 2 branches)
  BEGIN
    INSERT INTO public.branches (id, business_id, name, is_active, created_at)
    VALUES (v_extra_branch_id, v_target_biz, 'Third Branch Zero Payments', TRUE, NOW());

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);

    v_err_caught := FALSE;
    BEGIN
      PERFORM * FROM public.get_payroll_reconciliation_summary(v_target_biz, 'TestMonth', 2099);
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      IF v_err_msg ILIKE '%Reconciliation failed closed: Expected exactly 2 branches%' THEN
        v_err_caught := TRUE;
      ELSE
        RAISE EXCEPTION 'TEST FAILURE (C8a-1): Wrong error message: %', v_err_msg;
      END IF;
    END;
    IF NOT v_err_caught THEN
      RAISE EXCEPTION 'TEST FAILURE (C8a-1): Third branch with zero payments did not fail closed';
    END IF;

    RAISE EXCEPTION 'SUBTEST_ROLLBACK_8A1' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    NULL;
  END;

  -- 8a-2. Third branch WITH payments: must fail closed (requires exactly 2 branches)
  BEGIN
    INSERT INTO public.branches (id, business_id, name, is_active, created_at)
    VALUES (v_extra_branch_id, v_target_biz, 'Third Branch Test', TRUE, NOW());

    INSERT INTO public.staff (id, business_id, name, role, salary_amount, branch_id, created_at)
    VALUES (v_extra_teacher_id, v_target_biz, 'Test Third Branch Teacher', 'Teacher', 400, v_extra_branch_id, NOW());

    INSERT INTO public.staff_payments (id, business_id, staff_id, branch_id, month, year, amount, date, created_at)
    VALUES (v_extra_payment_id, v_target_biz, v_extra_teacher_id, v_extra_branch_id, 'TestMonth', 2099, 400, CURRENT_DATE, NOW());

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);

    v_err_caught := FALSE;
    BEGIN
      PERFORM * FROM public.get_payroll_reconciliation_summary(v_target_biz, 'TestMonth', 2099);
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      IF v_err_msg ILIKE '%Reconciliation failed closed: Expected exactly 2 branches%' THEN
        v_err_caught := TRUE;
      ELSE
        RAISE EXCEPTION 'TEST FAILURE (C8a-2): Wrong error message: %', v_err_msg;
      END IF;
    END;
    IF NOT v_err_caught THEN
      RAISE EXCEPTION 'TEST FAILURE (C8a-2): Third branch with payments did not fail closed';
    END IF;

    RAISE EXCEPTION 'SUBTEST_ROLLBACK_8A2' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    NULL;
  END;

  -- 8a-3. Third INACTIVE branch: must fail closed (inactive branches are NOT excluded from 2-branch invariant)
  BEGIN
    INSERT INTO public.branches (id, business_id, name, is_active, created_at)
    VALUES (v_extra_branch_id, v_target_biz, 'Third Branch Inactive', FALSE, NOW());

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);

    v_err_caught := FALSE;
    BEGIN
      PERFORM * FROM public.get_payroll_reconciliation_summary(v_target_biz, 'TestMonth', 2099);
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      IF v_err_msg ILIKE '%Reconciliation failed closed: Expected exactly 2 branches%' THEN
        v_err_caught := TRUE;
      ELSE
        RAISE EXCEPTION 'TEST FAILURE (C8a-3): Wrong error message: %', v_err_msg;
      END IF;
    END;
    IF NOT v_err_caught THEN
      RAISE EXCEPTION 'TEST FAILURE (C8a-3): Third inactive branch did not fail closed';
    END IF;

    RAISE EXCEPTION 'SUBTEST_ROLLBACK_8A3' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    NULL;
  END;

  -- 8b. Missing Kelisa Emas branch (2 branches total, one renamed): must fail closed
  BEGIN
    UPDATE public.branches SET name = 'Renamed Branch' WHERE id = v_kelisa_branch_id;

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);

    v_err_caught := FALSE;
    BEGIN
      PERFORM * FROM public.get_payroll_reconciliation_summary(v_target_biz, 'TestMonth', 2099);
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      IF v_err_msg ILIKE '%Reconciliation failed closed: Expected Kelisa Emas branch is missing%' THEN
        v_err_caught := TRUE;
      ELSE
        RAISE EXCEPTION 'TEST FAILURE (C8b): Wrong error message: %', v_err_msg;
      END IF;
    END;
    IF NOT v_err_caught THEN
      RAISE EXCEPTION 'TEST FAILURE (C8b): Missing Kelisa Emas branch did not fail closed';
    END IF;

    RAISE EXCEPTION 'SUBTEST_ROLLBACK_8B' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    NULL;
  END;

  -- 8c. Duplicate/ambiguous Pauh Jaya branch name (2 branches total): must fail closed
  BEGIN
    UPDATE public.branches SET name = 'Pauh Jaya Duplicate' WHERE id = v_kelisa_branch_id;

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);

    v_err_caught := FALSE;
    BEGIN
      PERFORM * FROM public.get_payroll_reconciliation_summary(v_target_biz, 'TestMonth', 2099);
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      IF v_err_msg ILIKE '%Reconciliation failed closed: Ambiguous/duplicate Pauh Jaya branch match%' THEN
        v_err_caught := TRUE;
      ELSE
        RAISE EXCEPTION 'TEST FAILURE (C8c): Wrong error message: %', v_err_msg;
      END IF;
    END;
    IF NOT v_err_caught THEN
      RAISE EXCEPTION 'TEST FAILURE (C8c): Duplicate Pauh Jaya branch did not fail closed';
    END IF;

    RAISE EXCEPTION 'SUBTEST_ROLLBACK_8C' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    NULL;
  END;

  -- 8d. Unexpected Kelisa Emas branch UUID (2 branches total, replaced UUID): must fail closed
  BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE public.branches SET name = 'Old KE' WHERE id = v_kelisa_branch_id;
    INSERT INTO public.branches (id, business_id, name, is_active, created_at)
    VALUES (v_extra_branch_id, v_target_biz, 'Kelisa Emas', TRUE, NOW());
    UPDATE public.groups SET branch_id = v_extra_branch_id WHERE branch_id = v_kelisa_branch_id;
    UPDATE public.customers SET branch_id = v_extra_branch_id WHERE branch_id = v_kelisa_branch_id;
    UPDATE public.payments SET branch_id = v_extra_branch_id WHERE branch_id = v_kelisa_branch_id;
    UPDATE public.business_users SET branch_id = v_extra_branch_id WHERE branch_id = v_kelisa_branch_id;
    UPDATE public.staff SET branch_id = v_extra_branch_id WHERE branch_id = v_kelisa_branch_id;
    UPDATE public.staff_payments SET branch_id = v_extra_branch_id WHERE branch_id = v_kelisa_branch_id;
    UPDATE public.expenses SET branch_id = v_extra_branch_id WHERE branch_id = v_kelisa_branch_id;
    DELETE FROM public.branches WHERE id = v_kelisa_branch_id;
    SET LOCAL session_replication_role = origin;

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_hana_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);

    v_err_caught := FALSE;
    BEGIN
      PERFORM * FROM public.get_payroll_reconciliation_summary(v_target_biz, 'TestMonth', 2099);
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      IF v_err_msg ILIKE '%Reconciliation failed closed: Kelisa Emas branch ID%' THEN
        v_err_caught := TRUE;
      ELSE
        RAISE EXCEPTION 'TEST FAILURE (C8d): Wrong error message: %', v_err_msg;
      END IF;
    END;
    IF NOT v_err_caught THEN
      RAISE EXCEPTION 'TEST FAILURE (C8d): Unexpected Kelisa Emas UUID did not fail closed';
    END IF;

    RAISE EXCEPTION 'SUBTEST_ROLLBACK_8D' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    NULL;
  END;

  RAISE NOTICE 'PART C PASSED: Fail-closed branch invariant tests verified for third branch (0 payments, with payments, inactive), missing branch, duplicate branch name, and unexpected UUID.';
END $$;

ROLLBACK;
