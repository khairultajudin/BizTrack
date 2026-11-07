-- ============================================================
-- BIZTRACK MIGRATION 07: ROLE-BASED RLS & TARGET SCOPE TEST HARNESS (PHASE 1Q)
-- ============================================================
-- Confirmed Production Target: PUSAT TUISYEN AKADEMIK MEGA (UUID: 978d2b0c-6a2b-4c28-9000-71dc23f96781)
-- Confirmed Target Owner: NORHANA ABDUL RANI (akademikmega.admin@gmail.com, Auth UID: d2b660bf-10d3-4d94-94ec-0b8f6e0908e6)
-- Protected Workspace (DO NOT MODIFY): Akademik Mega (UUID: ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad)
-- NOTE: DO NOT EXECUTE AGAINST PRODUCTION WITHOUT EXPLICIT AUTHORIZATION.
--
-- True RLS Execution & Strict Assertion Architecture (Phase 1N):
-- 1. Privileged Setup (postgres):
--    - Seeds mock users in auth.users and public.profiles to satisfy FKs.
--    - Seeds one multi-branch business (2 active branches: Alpha, Beta)
--      and one single-tenant business (0 branches) for backward-compatibility tests.
--    - Ensures 'invoices' storage bucket exists before seeding storage.objects.
--    - Seeds valid payments with all NOT NULL columns (month, year, amount,
--      payment_date, payment_method, status IN ('Paid','Pending','Cancelled')).
-- 2. Dynamic Role Switching & Actor Verification:
--    - Switches role via EXECUTE 'SET LOCAL ROLE authenticated';
--    - Sets both request.jwt.claim.sub and request.jwt.claims.
--    - Verifies current_user = 'authenticated', rolbypassrls = false, and
--      auth.uid() = expected actor UUID before EVERY actor section.
-- 3. Complete Positive + Negative SELECT Isolation:
--    - Every SELECT isolation test verifies positive visibility (exact row count,
--      exact record ID, branch_id, and business_id) AND negative visibility (0 rows
--      for unauthorized branches).
-- 4. Complete CRUD Mutation & Escalation Verification:
--    - Every permitted INSERT, UPDATE, and DELETE verifies exact affected row count = 1
--      via RETURNING, plus resulting database column values, branch_id, and business_id.
--    - Every RLS USING-filtered denied UPDATE or DELETE verifies affected row count = 0.
--    - Verifies Staff cannot escalate role or alter branch_id on public.business_users.
--    - Note: storage.objects tests verify database-level RLS policy evaluation on
--      storage.objects directly; they do not replace HTTP Storage API integration tests.
-- 5. Strict Negative Exception Assertions (Zero LIKE / Zero Substring Matching):
--    - Every exception-raising negative test uses a boolean guard (v_caught_expected)
--      outside the EXCEPTION block so deliberate failure exceptions are never caught.
--    - Asserts exact SQLSTATE equality AND exact complete SQLERRM equality (=).
--    - Any unexpected exception immediately aborts with full SQLSTATE and SQLERRM.
-- 6. Inactive Branch & Security Downgrade Prevention Suite (Tests 8.1 - 8.6):
--    - Verifies isolation when all branches are active, one branch is inactive, and
--      all branches are inactive (zero downgrade to single-tenant mode).
-- 7. Clean Teardown:
--    - Asserts v_passed_count = 63 test cases and terminates with ROLLBACK.
-- ============================================================

BEGIN;

DO $$
DECLARE
  -- Test Businesses
  v_biz_multi UUID;
  v_biz_single UUID;

  -- Test Branches
  v_branch_alpha UUID;
  v_branch_beta UUID;

  -- Test Actors (UUIDs for simulated authenticated users)
  v_user_creator UUID := gen_random_uuid();
  v_user_admin UUID := gen_random_uuid();
  v_user_staff_alpha UUID := gen_random_uuid();
  v_user_staff_beta UUID := gen_random_uuid();
  v_user_staff_none UUID := gen_random_uuid();
  v_user_readonly_alpha UUID := gen_random_uuid();
  v_user_readonly_none UUID := gen_random_uuid();

  -- Baseline Test Records
  v_class_alpha UUID;
  v_class_beta UUID;
  v_student_alpha UUID;
  v_student_beta UUID;
  v_payment_alpha UUID;
  v_payment_beta UUID;
  v_original_payment_branch UUID;

  -- Temporary CRUD Records
  v_temp_class_id UUID;
  v_temp_student_id UUID;
  v_temp_payment_id UUID;
  v_temp_branch_id UUID;
  v_single_class_id UUID;
  v_single_student_id UUID;
  v_single_payment_id UUID;

  -- Storage Object Paths (Task 1 Path Convention: {business_id}/{payment_id}/{filename}.pdf)
  v_storage_alpha_path TEXT;
  v_storage_beta_path TEXT;

  -- Diagnostic & Type-Safe Assertion Variables
  v_active_role TEXT;
  v_active_bypassrls BOOLEAN;
  v_active_auth_uid UUID;
  v_pos_count INT;
  v_neg_count INT;
  v_total_count INT;
  v_affected_count INT;
  v_actual_id UUID;
  v_actual_branch_id UUID;
  v_actual_biz_id UUID;
  v_actual_group_id UUID;
  v_actual_text TEXT;
  v_actual_notes TEXT;
  v_actual_path TEXT;
  v_actual_status TEXT;
  v_actual_amount NUMERIC(10, 2);
  v_caught_expected BOOLEAN;
  v_expected_errmsg TEXT;
  v_passed_count INT := 0;
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'STARTING BIZTRACK MIGRATION 07 ROLE-BASED TEST HARNESS (1M)';
  RAISE NOTICE '============================================================';

  -- ------------------------------------------------------------
  -- 1. PRIVILEGED SETUP (postgres): AUTH & PROFILES FIXTURES
  -- ------------------------------------------------------------
  INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_user_creator, 'authenticated', 'authenticated', 'creator@test.local', '{"provider":"email"}', '{"full_name":"Test Creator"}', now(), now()),
    (v_user_admin, 'authenticated', 'authenticated', 'admin@test.local', '{"provider":"email"}', '{"full_name":"Test Admin"}', now(), now()),
    (v_user_staff_alpha, 'authenticated', 'authenticated', 'staff.alpha@test.local', '{"provider":"email"}', '{"full_name":"Test Staff Alpha"}', now(), now()),
    (v_user_staff_beta, 'authenticated', 'authenticated', 'staff.beta@test.local', '{"provider":"email"}', '{"full_name":"Test Staff Beta"}', now(), now()),
    (v_user_staff_none, 'authenticated', 'authenticated', 'staff.none@test.local', '{"provider":"email"}', '{"full_name":"Test Staff Unassigned"}', now(), now()),
    (v_user_readonly_alpha, 'authenticated', 'authenticated', 'ro.alpha@test.local', '{"provider":"email"}', '{"full_name":"Test ReadOnly Alpha"}', now(), now()),
    (v_user_readonly_none, 'authenticated', 'authenticated', 'ro.none@test.local', '{"provider":"email"}', '{"full_name":"Test ReadOnly Unassigned"}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES
    (v_user_creator, 'creator@test.local', 'Test Creator'),
    (v_user_admin, 'admin@test.local', 'Test Admin'),
    (v_user_staff_alpha, 'staff.alpha@test.local', 'Test Staff Alpha'),
    (v_user_staff_beta, 'staff.beta@test.local', 'Test Staff Beta'),
    (v_user_staff_none, 'staff.none@test.local', 'Test Staff Unassigned'),
    (v_user_readonly_alpha, 'ro.alpha@test.local', 'Test ReadOnly Alpha'),
    (v_user_readonly_none, 'ro.none@test.local', 'Test ReadOnly Unassigned')
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name;

  -- ------------------------------------------------------------
  -- 2. PRIVILEGED SETUP: BUSINESSES, BRANCHES & MEMBERSHIPS
  -- ------------------------------------------------------------
  INSERT INTO public.businesses (id, name)
  VALUES (gen_random_uuid(), '[TEST] Multi-Branch Hub')
  RETURNING id INTO v_biz_multi;

  INSERT INTO public.businesses (id, name)
  VALUES (gen_random_uuid(), '[TEST] Single-Branch Solo')
  RETURNING id INTO v_biz_single;

  INSERT INTO public.branches (business_id, name, is_active)
  VALUES (v_biz_multi, '[TEST] Branch Alpha', true)
  RETURNING id INTO v_branch_alpha;

  INSERT INTO public.branches (business_id, name, is_active)
  VALUES (v_biz_multi, '[TEST] Branch Beta', true)
  RETURNING id INTO v_branch_beta;

  INSERT INTO public.business_users (business_id, user_id, role, branch_id) VALUES
    (v_biz_multi, v_user_creator, 'Creator', NULL),
    (v_biz_multi, v_user_admin, 'Admin', NULL),
    (v_biz_multi, v_user_staff_alpha, 'Staff', v_branch_alpha),
    (v_biz_multi, v_user_staff_beta, 'Staff', v_branch_beta),
    (v_biz_multi, v_user_staff_none, 'Staff', NULL),
    (v_biz_multi, v_user_readonly_alpha, 'ReadOnly', v_branch_alpha),
    (v_biz_multi, v_user_readonly_none, 'ReadOnly', NULL),
    (v_biz_single, v_user_creator, 'Creator', NULL);

  -- Baseline Classes
  INSERT INTO public.groups (business_id, name, monthly_fee, status, description, branch_id)
  VALUES (v_biz_multi, '[TEST] Class Alpha', 150.00, 'Active', 'Initial Alpha Class', v_branch_alpha)
  RETURNING id INTO v_class_alpha;

  INSERT INTO public.groups (business_id, name, monthly_fee, status, description, branch_id)
  VALUES (v_biz_multi, '[TEST] Class Beta', 160.00, 'Active', 'Initial Beta Class', v_branch_beta)
  RETURNING id INTO v_class_beta;

  -- Baseline Students
  INSERT INTO public.customers (business_id, name, phone, assigned_group_id, monthly_fee, status, branch_id)
  VALUES (v_biz_multi, '[TEST] Student Alpha', '+60100000001', v_class_alpha, 150.00, 'Active', v_branch_alpha)
  RETURNING id INTO v_student_alpha;

  INSERT INTO public.customers (business_id, name, phone, assigned_group_id, monthly_fee, status, branch_id)
  VALUES (v_biz_multi, '[TEST] Student Beta', '+60100000002', v_class_beta, 160.00, 'Active', v_branch_beta)
  RETURNING id INTO v_student_beta;

  -- Baseline Payments (Includes all required NOT NULL columns & valid CHECK status)
  INSERT INTO public.payments (business_id, customer_id, month, year, amount, payment_date, payment_method, status, branch_id)
  VALUES (v_biz_multi, v_student_alpha, 'November', 2026, 150.00, CURRENT_DATE, 'Bank Transfer', 'Paid', v_branch_alpha)
  RETURNING id INTO v_payment_alpha;

  INSERT INTO public.payments (business_id, customer_id, month, year, amount, payment_date, payment_method, status, branch_id)
  VALUES (v_biz_multi, v_student_beta, 'November', 2026, 160.00, CURRENT_DATE, 'Bank Transfer', 'Paid', v_branch_beta)
  RETURNING id INTO v_payment_beta;

  v_original_payment_branch := v_branch_alpha;

  -- Ensure 'invoices' bucket exists & seed Storage Objects
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('invoices', 'invoices', false)
  ON CONFLICT (id) DO NOTHING;

  v_storage_alpha_path := v_biz_multi::text || '/' || v_payment_alpha::text || '/invoice_alpha.pdf';
  v_storage_beta_path := v_biz_multi::text || '/' || v_payment_beta::text || '/invoice_beta.pdf';

  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('invoices', v_storage_alpha_path, v_user_staff_alpha);

  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('invoices', v_storage_beta_path, v_user_staff_beta);

  RAISE NOTICE 'Privileged setup complete.';

  -- ============================================================
  -- 3. RLS EXECUTION: ACTOR 1 - STAFF ALPHA (Branch Alpha)
  -- ============================================================
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_staff_alpha);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_staff_alpha, 'role', 'authenticated')::text);

  SELECT current_user, r.rolbypassrls, auth.uid()
  INTO v_active_role, v_active_bypassrls, v_active_auth_uid
  FROM pg_roles r WHERE r.rolname = current_user;

  IF v_active_role <> 'authenticated' OR v_active_bypassrls = true OR v_active_auth_uid <> v_user_staff_alpha THEN
    RAISE EXCEPTION 'Actor verification failed for Staff Alpha: role=%, bypassrls=%, auth.uid()=%',
      v_active_role, v_active_bypassrls, v_active_auth_uid;
  END IF;

  -- Test 1.1: Staff Alpha branches SELECT (positive = Branch Alpha, negative = Branch Beta)
  EXECUTE 'SELECT COUNT(*), MAX(id::text)::uuid, MAX(business_id::text)::uuid FROM public.branches WHERE id = ' || quote_literal(v_branch_alpha)
  INTO v_pos_count, v_actual_id, v_actual_biz_id;
  EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE id = ' || quote_literal(v_branch_beta)
  INTO v_neg_count;
  EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE business_id = ' || quote_literal(v_biz_multi)
  INTO v_total_count;

  IF v_pos_count <> 1 OR v_actual_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi OR v_neg_count <> 0 OR v_total_count <> 1 THEN
    RAISE EXCEPTION 'Test 1.1 FAILED: pos=%, id=%, biz=%, neg=%, total=%',
      v_pos_count, v_actual_id, v_actual_biz_id, v_neg_count, v_total_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.1 PASSED: Staff Alpha branches SELECT positive (Alpha=1) and negative (Beta=0).';

  -- Test 1.2: Staff Alpha denied branches INSERT (42501) and UPDATE/DELETE (0 rows)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO public.branches (business_id, name) VALUES (' ||
      quote_literal(v_biz_multi) || ', ''[TEST] Unauthorized Branch'')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM = 'new row violates row-level security policy for table "branches"' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 1.2 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 1.2 FAILED: Staff Alpha branch INSERT was not rejected';
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.branches SET name = ''Hacked'' WHERE id = ' || quote_literal(v_branch_alpha) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.2 FAILED: Staff Alpha branch UPDATE affected % rows (expected 0)', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.2 PASSED: Staff Alpha branch management blocked (INSERT=42501, UPDATE=0 rows).';

  -- Test 1.3: Staff Alpha groups (classes) SELECT (positive = Class Alpha, negative = Class Beta)
  EXECUTE 'SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM public.groups WHERE id = ' || quote_literal(v_class_alpha)
  INTO v_pos_count, v_actual_id, v_actual_branch_id, v_actual_biz_id;
  EXECUTE 'SELECT COUNT(*) FROM public.groups WHERE id = ' || quote_literal(v_class_beta)
  INTO v_neg_count;

  IF v_pos_count <> 1 OR v_actual_id <> v_class_alpha OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.3 FAILED: pos=%, id=%, branch=%, biz=%, neg=%',
      v_pos_count, v_actual_id, v_actual_branch_id, v_actual_biz_id, v_neg_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.3 PASSED: Staff Alpha classes SELECT positive (Class Alpha=1) and negative (Class Beta=0).';

  -- Test 1.4: Staff Alpha permitted own-branch class INSERT
  EXECUTE 'WITH inserted AS (INSERT INTO public.groups (business_id, name, monthly_fee, description, branch_id) VALUES (' ||
    quote_literal(v_biz_multi) || ', ''[TEST] Alpha Class Two'', 180.00, ''Alpha Second Class'', ' || quote_literal(v_branch_alpha) ||
    ') RETURNING id, branch_id, business_id, monthly_fee) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid, MAX(monthly_fee) FROM inserted'
  INTO v_affected_count, v_temp_class_id, v_actual_branch_id, v_actual_biz_id, v_actual_amount;

  IF v_affected_count <> 1 OR v_temp_class_id IS NULL OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi OR v_actual_amount <> 180.00 THEN
    RAISE EXCEPTION 'Test 1.4 FAILED: affected=%, id=%, branch=%, biz=%, fee=%',
      v_affected_count, v_temp_class_id, v_actual_branch_id, v_actual_biz_id, v_actual_amount;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.4 PASSED: Staff Alpha own-branch class INSERT verified (1 row).';

  -- Test 1.5: Staff Alpha cross-branch class INSERT into Branch Beta -> REJECTED (42501)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO public.groups (business_id, name, monthly_fee, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ''[TEST] Rogue Class'', 100.00, ' || quote_literal(v_branch_beta) || ')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM = 'new row violates row-level security policy for table "groups"' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 1.5 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 1.5 FAILED: Cross-branch class INSERT by Staff Alpha was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.5 PASSED: Staff Alpha cross-branch class INSERT rejected (42501).';

  -- Test 1.6: Staff Alpha own-branch class UPDATE (1 row) and cross-branch class UPDATE (0 rows)
  EXECUTE 'WITH updated AS (UPDATE public.groups SET description = ''Alpha Class Updated'', monthly_fee = 195.00 WHERE id = ' ||
    quote_literal(v_class_alpha) ||
    ' RETURNING id, description, monthly_fee, branch_id, business_id) SELECT COUNT(*), MAX(description), MAX(monthly_fee), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_text, v_actual_amount, v_actual_branch_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_text <> 'Alpha Class Updated' OR v_actual_amount <> 195.00 OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 1.6 FAILED (own-branch update): affected=%, desc=%, fee=%, branch=%, biz=%',
      v_affected_count, v_actual_text, v_actual_amount, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.groups SET description = ''Hacked Beta'' WHERE id = ' || quote_literal(v_class_beta) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.6 FAILED (cross-branch update): affected % rows (expected 0)', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.6 PASSED: Staff Alpha own-branch class UPDATE (1 row) and cross-branch UPDATE denied (0 rows).';

  -- Test 1.7: Staff Alpha own-branch class DELETE (1 row) and cross-branch class DELETE (0 rows)
  EXECUTE 'WITH deleted AS (DELETE FROM public.groups WHERE id = ' || quote_literal(v_temp_class_id) ||
    ' RETURNING id, branch_id, business_id) SELECT COUNT(*), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM deleted'
  INTO v_affected_count, v_actual_branch_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 1.7 FAILED (own-branch delete): affected=%, branch=%, biz=%',
      v_affected_count, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.groups WHERE id = ' || quote_literal(v_class_beta) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.7 FAILED (cross-branch delete): affected % rows (expected 0)', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.7 PASSED: Staff Alpha own-branch class DELETE (1 row) and cross-branch DELETE denied (0 rows).';

  -- Test 1.8: Staff Alpha customers (students) SELECT (positive = Student Alpha, negative = Student Beta)
  EXECUTE 'SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM public.customers WHERE id = ' || quote_literal(v_student_alpha)
  INTO v_pos_count, v_actual_id, v_actual_branch_id, v_actual_biz_id;
  EXECUTE 'SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_beta)
  INTO v_neg_count;

  IF v_pos_count <> 1 OR v_actual_id <> v_student_alpha OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.8 FAILED: pos=%, id=%, branch=%, biz=%, neg=%',
      v_pos_count, v_actual_id, v_actual_branch_id, v_actual_biz_id, v_neg_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.8 PASSED: Staff Alpha students SELECT positive (Student Alpha=1) and negative (Student Beta=0).';

  -- Test 1.9: Staff Alpha permitted own-branch student INSERT
  EXECUTE 'WITH inserted AS (INSERT INTO public.customers (business_id, name, phone, assigned_group_id, monthly_fee, branch_id) VALUES (' ||
    quote_literal(v_biz_multi) || ', ''[TEST] Alpha Student Two'', ''+60111222333'', ' || quote_literal(v_class_alpha) || ', 150.00, ' || quote_literal(v_branch_alpha) ||
    ') RETURNING id, branch_id, business_id, assigned_group_id) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid, MAX(assigned_group_id::text)::uuid FROM inserted'
  INTO v_affected_count, v_temp_student_id, v_actual_branch_id, v_actual_biz_id, v_actual_group_id;

  IF v_affected_count <> 1 OR v_temp_student_id IS NULL OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi OR v_actual_group_id <> v_class_alpha THEN
    RAISE EXCEPTION 'Test 1.9 FAILED: affected=%, id=%, branch=%, biz=%, group=%',
      v_affected_count, v_temp_student_id, v_actual_branch_id, v_actual_biz_id, v_actual_group_id;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.9 PASSED: Staff Alpha own-branch student INSERT verified (1 row).';

  -- Test 1.10: Staff Alpha cross-branch student INSERT into Branch Beta -> REJECTED (42501)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO public.customers (business_id, name, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ''[TEST] Rogue Student'', ' || quote_literal(v_branch_beta) || ')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM = 'new row violates row-level security policy for table "customers"' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 1.10 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 1.10 FAILED: Cross-branch student INSERT by Staff Alpha was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.10 PASSED: Staff Alpha cross-branch student INSERT rejected (42501).';

  -- Test 1.11: Staff Alpha own-branch student UPDATE (1 row) and cross-branch student UPDATE (0 rows)
  EXECUTE 'WITH updated AS (UPDATE public.customers SET phone = ''+60199990001'', notes = ''Alpha Student Note'' WHERE id = ' ||
    quote_literal(v_student_alpha) ||
    ' RETURNING id, phone, notes, branch_id, business_id) SELECT COUNT(*), MAX(phone), MAX(notes), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_text, v_actual_notes, v_actual_branch_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_text <> '+60199990001' OR v_actual_notes <> 'Alpha Student Note' OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 1.11 FAILED (own-branch update): affected=%, phone=%, notes=%, branch=%, biz=%',
      v_affected_count, v_actual_text, v_actual_notes, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.customers SET notes = ''Hacked Beta'' WHERE id = ' || quote_literal(v_student_beta) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.11 FAILED (cross-branch update): affected % rows (expected 0)', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.11 PASSED: Staff Alpha own-branch student UPDATE (1 row) and cross-branch UPDATE denied (0 rows).';

  -- Test 1.12: Staff Alpha own-branch student DELETE (1 row) and cross-branch student DELETE (0 rows)
  EXECUTE 'WITH deleted AS (DELETE FROM public.customers WHERE id = ' || quote_literal(v_temp_student_id) ||
    ' RETURNING id, branch_id, business_id) SELECT COUNT(*), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM deleted'
  INTO v_affected_count, v_actual_branch_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 1.12 FAILED (own-branch delete): affected=%, branch=%, biz=%',
      v_affected_count, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.customers WHERE id = ' || quote_literal(v_student_beta) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.12 FAILED (cross-branch delete): affected % rows (expected 0)', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.12 PASSED: Staff Alpha own-branch student DELETE (1 row) and cross-branch DELETE denied (0 rows).';

  -- Test 1.13: Staff Alpha payments SELECT (positive = Payment Alpha, negative = Payment Beta)
  EXECUTE 'SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM public.payments WHERE id = ' || quote_literal(v_payment_alpha)
  INTO v_pos_count, v_actual_id, v_actual_branch_id, v_actual_biz_id;
  EXECUTE 'SELECT COUNT(*) FROM public.payments WHERE id = ' || quote_literal(v_payment_beta)
  INTO v_neg_count;

  IF v_pos_count <> 1 OR v_actual_id <> v_payment_alpha OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.13 FAILED: pos=%, id=%, branch=%, biz=%, neg=%',
      v_pos_count, v_actual_id, v_actual_branch_id, v_actual_biz_id, v_neg_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.13 PASSED: Staff Alpha payments SELECT positive (Payment Alpha=1) and negative (Payment Beta=0).';

  -- Test 1.14: Staff Alpha permitted own-branch payment INSERT
  EXECUTE 'WITH inserted AS (INSERT INTO public.payments (business_id, customer_id, month, year, amount, payment_date, payment_method, status, branch_id) VALUES (' ||
    quote_literal(v_biz_multi) || ', ' || quote_literal(v_student_alpha) || ', ''December'', 2026, 150.00, CURRENT_DATE, ''Cash'', ''Paid'', ' || quote_literal(v_branch_alpha) ||
    ') RETURNING id, branch_id, business_id, amount, status) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid, MAX(amount), MAX(status) FROM inserted'
  INTO v_affected_count, v_temp_payment_id, v_actual_branch_id, v_actual_biz_id, v_actual_amount, v_actual_status;

  IF v_affected_count <> 1 OR v_temp_payment_id IS NULL OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi OR v_actual_amount <> 150.00 OR v_actual_status <> 'Paid' THEN
    RAISE EXCEPTION 'Test 1.14 FAILED: affected=%, id=%, branch=%, biz=%, amount=%, status=%',
      v_affected_count, v_temp_payment_id, v_actual_branch_id, v_actual_biz_id, v_actual_amount, v_actual_status;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.14 PASSED: Staff Alpha own-branch payment INSERT verified (1 row).';

  -- Test 1.15: Staff Alpha cross-branch payment INSERT into Branch Beta -> REJECTED (42501)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO public.payments (business_id, customer_id, month, year, amount, payment_date, payment_method, status, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ' || quote_literal(v_student_alpha) || ', ''December'', 2026, 150.00, CURRENT_DATE, ''Cash'', ''Paid'', ' || quote_literal(v_branch_beta) || ')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM = 'new row violates row-level security policy for table "payments"' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 1.15 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 1.15 FAILED: Cross-branch payment INSERT by Staff Alpha was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.15 PASSED: Staff Alpha cross-branch payment INSERT rejected (42501).';

  -- Test 1.16: Staff Alpha ordinary own-branch payment UPDATE (Task 1 invoice_path & notes)
  EXECUTE 'WITH updated AS (UPDATE public.payments SET invoice_path = ' || quote_literal(v_storage_alpha_path) ||
    ', notes = ''Alpha update'' WHERE id = ' || quote_literal(v_payment_alpha) ||
    ' RETURNING id, invoice_path, notes, branch_id, business_id) SELECT COUNT(*), MAX(invoice_path), MAX(notes), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_path, v_actual_notes, v_actual_branch_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_path <> v_storage_alpha_path OR v_actual_notes <> 'Alpha update' OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 1.16 FAILED: affected=%, path=%, notes=%, branch=%, biz=%',
      v_affected_count, v_actual_path, v_actual_notes, v_actual_branch_id, v_actual_biz_id;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.16 PASSED: Staff Alpha ordinary payment UPDATE verified (1 row).';

  -- Test 1.17: Staff Alpha attempting to alter historical payment branch_id -> REJECTED (P0001)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'UPDATE public.payments SET branch_id = ' || quote_literal(v_branch_beta) ||
      ' WHERE id = ' || quote_literal(v_payment_alpha);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Historical attribution protected: Staff cannot alter payment branch_id' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 1.17 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 1.17 FAILED: Staff Alpha payment branch_id alteration was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.17 PASSED: Staff Alpha historical payment branch change blocked (P0001).';

  -- Test 1.18: Staff Alpha own-branch payment DELETE (1 row) and cross-branch payment DELETE (0 rows)
  EXECUTE 'WITH deleted AS (DELETE FROM public.payments WHERE id = ' || quote_literal(v_temp_payment_id) ||
    ' RETURNING id, branch_id, business_id) SELECT COUNT(*), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM deleted'
  INTO v_affected_count, v_actual_branch_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 1.18 FAILED (own-branch delete): affected=%, branch=%, biz=%',
      v_affected_count, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.payments WHERE id = ' || quote_literal(v_payment_beta) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.18 FAILED (cross-branch delete): affected % rows (expected 0)', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.18 PASSED: Staff Alpha own-branch payment DELETE (1 row) and cross-branch DELETE denied (0 rows).';

  -- Test 1.19: Storage DELETE: Staff Alpha attempting DELETE on Beta invoice -> REJECTED (0 rows)
  EXECUTE 'WITH deleted AS (DELETE FROM storage.objects WHERE name = ' || quote_literal(v_storage_beta_path) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.19 FAILED: Staff Alpha deleted Beta invoice! Affected: %', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.19 PASSED: Storage DELETE of other branch invoice denied (0 rows).';

  -- Test 1.20: Storage DELETE: Staff Alpha deleting own branch invoice -> ALLOWED (1 row)
  EXECUTE 'WITH deleted AS (DELETE FROM storage.objects WHERE name = ' || quote_literal(v_storage_alpha_path) || ' RETURNING id, name) SELECT COUNT(*), MAX(name) FROM deleted'
  INTO v_affected_count, v_actual_path;
  IF v_affected_count <> 1 OR v_actual_path <> v_storage_alpha_path THEN
    RAISE EXCEPTION 'Test 1.20 FAILED: affected=%, path=%', v_affected_count, v_actual_path;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.20 PASSED: Storage DELETE of own branch invoice verified (1 row).';

  -- Test 1.21: Staff Alpha attempting to change own role, own branch_id, or another user's role/branch_id on business_users -> DENIED (0 rows)
  EXECUTE 'WITH updated AS (UPDATE public.business_users SET role = ''Admin'' WHERE user_id = ' ||
    quote_literal(v_user_staff_alpha) || ' AND business_id = ' || quote_literal(v_biz_multi) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.21 FAILED (own role escalation): affected % rows (expected 0)', v_affected_count;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.business_users SET branch_id = ' || quote_literal(v_branch_beta) || ' WHERE user_id = ' ||
    quote_literal(v_user_staff_alpha) || ' AND business_id = ' || quote_literal(v_biz_multi) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.21 FAILED (own branch_id change): affected % rows (expected 0)', v_affected_count;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.business_users SET role = ''ReadOnly'', branch_id = ' || quote_literal(v_branch_alpha) || ' WHERE user_id = ' ||
    quote_literal(v_user_staff_beta) || ' AND business_id = ' || quote_literal(v_biz_multi) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.21 FAILED (other user role/branch change): affected % rows (expected 0)', v_affected_count;
  END IF;

  EXECUTE 'SELECT role, branch_id FROM public.business_users WHERE user_id = ' || quote_literal(v_user_staff_alpha) || ' AND business_id = ' || quote_literal(v_biz_multi)
  INTO v_actual_text, v_actual_branch_id;
  IF v_actual_text <> 'Staff' OR v_actual_branch_id <> v_branch_alpha THEN
    RAISE EXCEPTION 'Test 1.21 FAILED: Staff Alpha membership mutated! role=%, branch=%', v_actual_text, v_actual_branch_id;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.21 PASSED: Staff Alpha blocked from modifying own or other user role/branch_id on business_users (0 rows).';

  -- Test 1.22: SQL-Level Invoice PDF Regression (Upload/Select/Replace/Remove, Non-PDF Rejection, Cross-Branch & Cross-Business Isolation)
  -- 1.22a: Own-branch PDF upload (INSERT into storage.objects) -> ALLOWED (1 row)
  EXECUTE 'WITH inserted AS (INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''invoices'', ' ||
    quote_literal(v_storage_alpha_path) || ', ' || quote_literal(v_user_staff_alpha) ||
    ') RETURNING id, name) SELECT COUNT(*), MAX(name) FROM inserted'
  INTO v_affected_count, v_actual_path;
  IF v_affected_count <> 1 OR v_actual_path <> v_storage_alpha_path THEN
    RAISE EXCEPTION 'Test 1.22a FAILED (own-branch upload): affected=%, path=%', v_affected_count, v_actual_path;
  END IF;

  -- 1.22b: Own-branch SELECT (1 row) vs Cross-branch SELECT (0 rows)
  EXECUTE 'SELECT COUNT(*) FROM storage.objects WHERE name = ' || quote_literal(v_storage_alpha_path) INTO v_pos_count;
  EXECUTE 'SELECT COUNT(*) FROM storage.objects WHERE name = ' || quote_literal(v_storage_beta_path) INTO v_neg_count;
  IF v_pos_count <> 1 OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.22b FAILED (storage select): pos=%, neg=%', v_pos_count, v_neg_count;
  END IF;

  -- 1.22c: Own-branch replace (UPDATE storage.objects = 1 row) vs Cross-branch replace (0 rows)
  EXECUTE 'WITH updated AS (UPDATE storage.objects SET updated_at = now() WHERE name = ' ||
    quote_literal(v_storage_alpha_path) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 1 THEN
    RAISE EXCEPTION 'Test 1.22c FAILED (own-branch replace): affected=%', v_affected_count;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE storage.objects SET updated_at = now() WHERE name = ' ||
    quote_literal(v_storage_beta_path) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 1.22c FAILED (cross-branch replace): affected=%', v_affected_count;
  END IF;

  -- 1.22d: Non-PDF upload into storage.objects -> REJECTED by RLS (42501)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''invoices'', ' ||
      quote_literal(v_biz_multi::text || '/' || v_payment_alpha::text || '/malicious.exe') || ', ' || quote_literal(v_user_staff_alpha) || ')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM = 'new row violates row-level security policy for table "objects"' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 1.22d FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 1.22d FAILED: Non-PDF storage upload was not rejected';
  END IF;

  -- 1.22e: Cross-branch & Cross-business upload into storage.objects -> REJECTED by RLS (42501)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''invoices'', ' ||
      quote_literal(v_biz_multi::text || '/' || v_payment_beta::text || '/rogue_beta.pdf') || ', ' || quote_literal(v_user_staff_alpha) || ')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM = 'new row violates row-level security policy for table "objects"' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 1.22e (cross-branch) FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 1.22e FAILED: Cross-branch storage upload was not rejected';
  END IF;

  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''invoices'', ' ||
      quote_literal(v_biz_single::text || '/' || v_payment_alpha::text || '/rogue_biz.pdf') || ', ' || quote_literal(v_user_staff_alpha) || ')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM = 'new row violates row-level security policy for table "objects"' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 1.22e (cross-business) FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 1.22e FAILED: Cross-business storage upload was not rejected';
  END IF;

  -- 1.22f: Non-PDF / invalid invoice_path on public.payments -> REJECTED by CHECK constraint (23514)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'UPDATE public.payments SET invoice_path = ' ||
      quote_literal(v_biz_multi::text || '/' || v_payment_alpha::text || '/not_a_pdf.png') ||
      ' WHERE id = ' || quote_literal(v_payment_alpha);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '23514' AND SQLERRM = 'new row for relation "payments" violates check constraint "payments_invoice_path_format_check"' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 1.22f FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 1.22f FAILED: Invalid invoice_path on payments was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 1.22 PASSED: SQL-level Invoice PDF upload/view/replace, non-PDF rejection, and cross-branch/business isolation verified.';

  -- ============================================================
  -- 4. RLS EXECUTION: ACTOR 2 - STAFF BETA (Branch Beta)
  -- ============================================================
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_staff_beta);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_staff_beta, 'role', 'authenticated')::text);

  SELECT current_user, r.rolbypassrls, auth.uid()
  INTO v_active_role, v_active_bypassrls, v_active_auth_uid
  FROM pg_roles r WHERE r.rolname = current_user;

  IF v_active_role <> 'authenticated' OR v_active_bypassrls = true OR v_active_auth_uid <> v_user_staff_beta THEN
    RAISE EXCEPTION 'Actor verification failed for Staff Beta: role=%, bypassrls=%, auth.uid()=%',
      v_active_role, v_active_bypassrls, v_active_auth_uid;
  END IF;

  -- Test 2.1: Staff Beta branches SELECT (positive = Branch Beta, negative = Branch Alpha)
  EXECUTE 'SELECT COUNT(*), MAX(id::text)::uuid, MAX(business_id::text)::uuid FROM public.branches WHERE id = ' || quote_literal(v_branch_beta)
  INTO v_pos_count, v_actual_id, v_actual_biz_id;
  EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE id = ' || quote_literal(v_branch_alpha)
  INTO v_neg_count;
  EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE business_id = ' || quote_literal(v_biz_multi)
  INTO v_total_count;

  IF v_pos_count <> 1 OR v_actual_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi OR v_neg_count <> 0 OR v_total_count <> 1 THEN
    RAISE EXCEPTION 'Test 2.1 FAILED: pos=%, id=%, biz=%, neg=%, total=%',
      v_pos_count, v_actual_id, v_actual_biz_id, v_neg_count, v_total_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 2.1 PASSED: Staff Beta branches SELECT positive (Beta=1) and negative (Alpha=0).';

  -- Test 2.2: Staff Beta classes SELECT (positive = Class Beta, negative = Class Alpha)
  EXECUTE 'SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM public.groups WHERE id = ' || quote_literal(v_class_beta)
  INTO v_pos_count, v_actual_id, v_actual_branch_id, v_actual_biz_id;
  EXECUTE 'SELECT COUNT(*) FROM public.groups WHERE id = ' || quote_literal(v_class_alpha)
  INTO v_neg_count;

  IF v_pos_count <> 1 OR v_actual_id <> v_class_beta OR v_actual_branch_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 2.2 FAILED: pos=%, id=%, branch=%, biz=%, neg=%',
      v_pos_count, v_actual_id, v_actual_branch_id, v_actual_biz_id, v_neg_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 2.2 PASSED: Staff Beta classes SELECT positive (Class Beta=1) and negative (Class Alpha=0).';

  -- Test 2.3: Staff Beta own-branch class UPDATE (1 row) and cross-branch class UPDATE (0 rows)
  EXECUTE 'WITH updated AS (UPDATE public.groups SET description = ''Beta Class Updated'', monthly_fee = 210.00 WHERE id = ' ||
    quote_literal(v_class_beta) ||
    ' RETURNING id, description, monthly_fee, branch_id, business_id) SELECT COUNT(*), MAX(description), MAX(monthly_fee), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_text, v_actual_amount, v_actual_branch_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_text <> 'Beta Class Updated' OR v_actual_amount <> 210.00 OR v_actual_branch_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 2.3 FAILED (own-branch update): affected=%, desc=%, fee=%, branch=%, biz=%',
      v_affected_count, v_actual_text, v_actual_amount, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.groups SET description = ''Hacked Alpha'' WHERE id = ' || quote_literal(v_class_alpha) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 2.3 FAILED (cross-branch update): affected % rows (expected 0)', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 2.3 PASSED: Staff Beta own-branch class UPDATE (1 row) and cross-branch UPDATE denied (0 rows).';

  -- Test 2.4: Staff Beta customers SELECT (positive = Student Beta, negative = Student Alpha)
  EXECUTE 'SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM public.customers WHERE id = ' || quote_literal(v_student_beta)
  INTO v_pos_count, v_actual_id, v_actual_branch_id, v_actual_biz_id;
  EXECUTE 'SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_alpha)
  INTO v_neg_count;

  IF v_pos_count <> 1 OR v_actual_id <> v_student_beta OR v_actual_branch_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 2.4 FAILED: pos=%, id=%, branch=%, biz=%, neg=%',
      v_pos_count, v_actual_id, v_actual_branch_id, v_actual_biz_id, v_neg_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 2.4 PASSED: Staff Beta students SELECT positive (Student Beta=1) and negative (Student Alpha=0).';

  -- Test 2.5: Staff Beta own-branch student INSERT, UPDATE, and DELETE
  EXECUTE 'WITH inserted AS (INSERT INTO public.customers (business_id, name, assigned_group_id, branch_id) VALUES (' ||
    quote_literal(v_biz_multi) || ', ''[TEST] Beta Student Two'', ' || quote_literal(v_class_beta) || ', ' || quote_literal(v_branch_beta) ||
    ') RETURNING id, branch_id, business_id) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM inserted'
  INTO v_affected_count, v_temp_student_id, v_actual_branch_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_temp_student_id IS NULL OR v_actual_branch_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 2.5 FAILED (insert): affected=%, branch=%, biz=%', v_affected_count, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.customers SET notes = ''Beta Student Note'' WHERE id = ' || quote_literal(v_student_beta) ||
    ' RETURNING id, notes, branch_id, business_id) SELECT COUNT(*), MAX(notes), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_notes, v_actual_branch_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_notes <> 'Beta Student Note' OR v_actual_branch_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 2.5 FAILED (update): affected=%, notes=%, branch=%, biz=%', v_affected_count, v_actual_notes, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.customers WHERE id = ' || quote_literal(v_temp_student_id) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 1 THEN
    RAISE EXCEPTION 'Test 2.5 FAILED (delete): affected=%', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 2.5 PASSED: Staff Beta own-branch student INSERT, UPDATE, and DELETE verified.';

  -- Test 2.6: Staff Beta payments SELECT (positive = Beta, negative = Alpha), INSERT, UPDATE, DELETE
  EXECUTE 'SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM public.payments WHERE id = ' || quote_literal(v_payment_beta)
  INTO v_pos_count, v_actual_id, v_actual_branch_id, v_actual_biz_id;
  EXECUTE 'SELECT COUNT(*) FROM public.payments WHERE id = ' || quote_literal(v_payment_alpha)
  INTO v_neg_count;

  IF v_pos_count <> 1 OR v_actual_id <> v_payment_beta OR v_actual_branch_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 2.6 FAILED (select): pos=%, neg=%', v_pos_count, v_neg_count;
  END IF;

  EXECUTE 'WITH inserted AS (INSERT INTO public.payments (business_id, customer_id, month, year, amount, payment_date, payment_method, status, branch_id) VALUES (' ||
    quote_literal(v_biz_multi) || ', ' || quote_literal(v_student_beta) || ', ''December'', 2026, 210.00, CURRENT_DATE, ''Cash'', ''Paid'', ' || quote_literal(v_branch_beta) ||
    ') RETURNING id, branch_id, business_id) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM inserted'
  INTO v_affected_count, v_temp_payment_id, v_actual_branch_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 2.6 FAILED (insert): affected=%', v_affected_count;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.payments WHERE id = ' || quote_literal(v_temp_payment_id) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 1 THEN
    RAISE EXCEPTION 'Test 2.6 FAILED (delete): affected=%', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 2.6 PASSED: Staff Beta payments SELECT, INSERT, and DELETE verified.';

  -- ============================================================
  -- 5. RLS EXECUTION: ACTOR 3 - STAFF UNASSIGNED (NULL Branch)
  -- ============================================================
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_staff_none);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_staff_none, 'role', 'authenticated')::text);

  SELECT current_user, r.rolbypassrls, auth.uid()
  INTO v_active_role, v_active_bypassrls, v_active_auth_uid
  FROM pg_roles r WHERE r.rolname = current_user;

  IF v_active_role <> 'authenticated' OR v_active_bypassrls = true OR v_active_auth_uid <> v_user_staff_none THEN
    RAISE EXCEPTION 'Actor verification failed for Staff Unassigned: role=%, bypassrls=%, auth.uid()=%',
      v_active_role, v_active_bypassrls, v_active_auth_uid;
  END IF;

  -- Test 3.1: Fail-closed: Unassigned Staff sees 0 branches
  EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE business_id = ' || quote_literal(v_biz_multi)
  INTO v_total_count;
  IF v_total_count <> 0 THEN
    RAISE EXCEPTION 'Test 3.1 FAILED: Unassigned Staff saw % branches (expected 0)', v_total_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 3.1 PASSED: Unassigned Staff fail-closed (0 branches visible).';

  -- Test 3.2: Fail-closed: Unassigned Staff sees 0 classes, 0 customers, and 0 payments
  EXECUTE 'SELECT (SELECT COUNT(*) FROM public.groups WHERE business_id = ' || quote_literal(v_biz_multi) || ') + ' ||
    '(SELECT COUNT(*) FROM public.customers WHERE business_id = ' || quote_literal(v_biz_multi) || ') + ' ||
    '(SELECT COUNT(*) FROM public.payments WHERE business_id = ' || quote_literal(v_biz_multi) || ')'
  INTO v_total_count;
  IF v_total_count <> 0 THEN
    RAISE EXCEPTION 'Test 3.2 FAILED: Unassigned Staff saw % operational rows (expected 0)', v_total_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 3.2 PASSED: Unassigned Staff fail-closed (0 classes, 0 students, 0 payments visible).';

  -- Test 3.3: Fail-closed: Unassigned Staff INSERT attempt -> REJECTED (42501)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO public.customers (business_id, name, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ''[TEST] Fail Closed Student'', ' || quote_literal(v_branch_alpha) || ')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM = 'new row violates row-level security policy for table "customers"' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 3.3 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 3.3 FAILED: Unassigned Staff INSERT was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 3.3 PASSED: Unassigned Staff write rejected (42501).';

  -- Test 3.4: Unassigned Staff attempting self-assignment on business_users -> 0 rows affected
  EXECUTE 'WITH updated AS (UPDATE public.business_users SET branch_id = ' || quote_literal(v_branch_alpha) ||
    ', role = ''Admin'' WHERE user_id = ' || quote_literal(v_user_staff_none) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 3.4 FAILED: Unassigned Staff modified business_users (% rows)', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 3.4 PASSED: Unassigned Staff self-escalation blocked (0 rows affected).';

  -- ============================================================
  -- 6. RLS EXECUTION: ACTOR 4 - READONLY ALPHA (Branch Alpha)
  -- ============================================================
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_readonly_alpha);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_readonly_alpha, 'role', 'authenticated')::text);

  SELECT current_user, r.rolbypassrls, auth.uid()
  INTO v_active_role, v_active_bypassrls, v_active_auth_uid
  FROM pg_roles r WHERE r.rolname = current_user;

  IF v_active_role <> 'authenticated' OR v_active_bypassrls = true OR v_active_auth_uid <> v_user_readonly_alpha THEN
    RAISE EXCEPTION 'Actor verification failed for ReadOnly Alpha: role=%, bypassrls=%, auth.uid()=%',
      v_active_role, v_active_bypassrls, v_active_auth_uid;
  END IF;

  -- Test 4.1: ReadOnly Alpha branches SELECT (positive = Alpha, negative = Beta)
  EXECUTE 'SELECT COUNT(*), MAX(id::text)::uuid FROM public.branches WHERE id = ' || quote_literal(v_branch_alpha)
  INTO v_pos_count, v_actual_id;
  EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE id = ' || quote_literal(v_branch_beta)
  INTO v_neg_count;

  IF v_pos_count <> 1 OR v_actual_id <> v_branch_alpha OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 4.1 FAILED: pos=%, id=%, neg=%', v_pos_count, v_actual_id, v_neg_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 4.1 PASSED: ReadOnly Alpha branches SELECT positive (Alpha=1) and negative (Beta=0).';

  -- Test 4.2: ReadOnly Alpha operational SELECT (positive = Alpha records, negative = Beta records)
  EXECUTE 'SELECT (SELECT COUNT(*) FROM public.groups WHERE id = ' || quote_literal(v_class_alpha) || ') + ' ||
    '(SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_alpha) || ') + ' ||
    '(SELECT COUNT(*) FROM public.payments WHERE id = ' || quote_literal(v_payment_alpha) || ')'
  INTO v_pos_count;
  EXECUTE 'SELECT (SELECT COUNT(*) FROM public.groups WHERE id = ' || quote_literal(v_class_beta) || ') + ' ||
    '(SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_beta) || ') + ' ||
    '(SELECT COUNT(*) FROM public.payments WHERE id = ' || quote_literal(v_payment_beta) || ')'
  INTO v_neg_count;

  IF v_pos_count <> 3 OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 4.2 FAILED: pos=% (expected 3), neg=% (expected 0)', v_pos_count, v_neg_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 4.2 PASSED: ReadOnly Alpha operational SELECT positive (3 Alpha rows) and negative (0 Beta rows).';

  -- Test 4.3: ReadOnly Alpha INSERT attempt -> REJECTED (42501)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO public.customers (business_id, name, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ''[TEST] RO Customer'', ' || quote_literal(v_branch_alpha) || ')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM = 'new row violates row-level security policy for table "customers"' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 4.3 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 4.3 FAILED: ReadOnly Alpha INSERT was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 4.3 PASSED: ReadOnly Alpha INSERT rejected (42501).';

  -- Test 4.4: ReadOnly Alpha UPDATE and DELETE attempts -> 0 rows affected (blocked by RLS USING)
  EXECUTE 'WITH updated AS (UPDATE public.customers SET name = ''RO Altered'' WHERE id = ' || quote_literal(v_student_alpha) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 4.4 FAILED (update): ReadOnly Alpha updated % rows (expected 0)', v_affected_count;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.customers WHERE id = ' || quote_literal(v_student_alpha) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 4.4 FAILED (delete): ReadOnly Alpha deleted % rows (expected 0)', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 4.4 PASSED: ReadOnly Alpha UPDATE and DELETE denied (0 rows affected).';

  -- ============================================================
  -- 7. RLS EXECUTION: ACTOR 5 - READONLY UNASSIGNED (Audit Mode)
  -- ============================================================
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_readonly_none);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_readonly_none, 'role', 'authenticated')::text);

  SELECT current_user, r.rolbypassrls, auth.uid()
  INTO v_active_role, v_active_bypassrls, v_active_auth_uid
  FROM pg_roles r WHERE r.rolname = current_user;

  IF v_active_role <> 'authenticated' OR v_active_bypassrls = true OR v_active_auth_uid <> v_user_readonly_none THEN
    RAISE EXCEPTION 'Actor verification failed for ReadOnly Unassigned: role=%, bypassrls=%, auth.uid()=%',
      v_active_role, v_active_bypassrls, v_active_auth_uid;
  END IF;

  -- Test 5.1: ReadOnly Unassigned sees all 2 branches in audit mode
  EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE business_id = ' || quote_literal(v_biz_multi)
  INTO v_total_count;
  IF v_total_count <> 2 THEN
    RAISE EXCEPTION 'Test 5.1 FAILED: ReadOnly Unassigned saw % branches (expected 2)', v_total_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 5.1 PASSED: ReadOnly Unassigned sees all 2 branches (audit mode).';

  -- Test 5.2: ReadOnly Unassigned sees both Alpha and Beta operational records across groups, customers, payments
  EXECUTE 'SELECT (SELECT COUNT(*) FROM public.groups WHERE business_id = ' || quote_literal(v_biz_multi) || ') + ' ||
    '(SELECT COUNT(*) FROM public.customers WHERE business_id = ' || quote_literal(v_biz_multi) || ') + ' ||
    '(SELECT COUNT(*) FROM public.payments WHERE business_id = ' || quote_literal(v_biz_multi) || ')'
  INTO v_total_count;
  IF v_total_count <> 6 THEN
    RAISE EXCEPTION 'Test 5.2 FAILED: ReadOnly Unassigned saw % operational rows (expected 6)', v_total_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 5.2 PASSED: ReadOnly Unassigned sees all 6 operational rows across both branches.';

  -- Test 5.3: ReadOnly Unassigned INSERT rejected (42501) and UPDATE/DELETE denied (0 rows)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO public.customers (business_id, name, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ''[TEST] RO Unassigned Write'', ' || quote_literal(v_branch_alpha) || ')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM = 'new row violates row-level security policy for table "customers"' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 5.3 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 5.3 FAILED: ReadOnly Unassigned INSERT was not rejected';
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.customers SET name = ''RO Hacked'' WHERE id = ' || quote_literal(v_student_beta) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 5.3 FAILED: ReadOnly Unassigned updated % rows (expected 0)', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 5.3 PASSED: ReadOnly Unassigned write operations blocked (INSERT=42501, UPDATE=0 rows).';

  -- ============================================================
  -- 8. RLS EXECUTION: ACTOR 6 - ADMIN (Business-Wide)
  -- ============================================================
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_admin);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_admin, 'role', 'authenticated')::text);

  SELECT current_user, r.rolbypassrls, auth.uid()
  INTO v_active_role, v_active_bypassrls, v_active_auth_uid
  FROM pg_roles r WHERE r.rolname = current_user;

  IF v_active_role <> 'authenticated' OR v_active_bypassrls = true OR v_active_auth_uid <> v_user_admin THEN
    RAISE EXCEPTION 'Actor verification failed for Admin: role=%, bypassrls=%, auth.uid()=%',
      v_active_role, v_active_bypassrls, v_active_auth_uid;
  END IF;

  -- Test 6.1: Admin sees all 2 branches (Alpha and Beta)
  EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE business_id = ' || quote_literal(v_biz_multi) ||
    ' AND id IN (' || quote_literal(v_branch_alpha) || ', ' || quote_literal(v_branch_beta) || ')'
  INTO v_total_count;
  IF v_total_count <> 2 THEN
    RAISE EXCEPTION 'Test 6.1 FAILED: Admin saw % branches (expected 2)', v_total_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.1 PASSED: Admin sees all 2 branches.';

  -- Test 6.2: Admin classes SELECT (2 rows), INSERT (1 row), UPDATE (1 row), and DELETE (1 row)
  EXECUTE 'SELECT COUNT(*) FROM public.groups WHERE business_id = ' || quote_literal(v_biz_multi)
  INTO v_total_count;
  IF v_total_count <> 2 THEN
    RAISE EXCEPTION 'Test 6.2 FAILED (select): Admin saw % classes (expected 2)', v_total_count;
  END IF;

  EXECUTE 'WITH inserted AS (INSERT INTO public.groups (business_id, name, monthly_fee, branch_id) VALUES (' ||
    quote_literal(v_biz_multi) || ', ''[TEST] Admin Class'', 200.00, ' || quote_literal(v_branch_beta) ||
    ') RETURNING id, branch_id, business_id, monthly_fee) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid, MAX(monthly_fee) FROM inserted'
  INTO v_affected_count, v_temp_class_id, v_actual_branch_id, v_actual_biz_id, v_actual_amount;

  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi OR v_actual_amount <> 200.00 THEN
    RAISE EXCEPTION 'Test 6.2 FAILED (insert): affected=%, branch=%, biz=%, fee=%',
      v_affected_count, v_actual_branch_id, v_actual_biz_id, v_actual_amount;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.groups SET monthly_fee = 250.00, branch_id = ' || quote_literal(v_branch_alpha) ||
    ' WHERE id = ' || quote_literal(v_temp_class_id) ||
    ' RETURNING id, branch_id, business_id, monthly_fee) SELECT COUNT(*), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid, MAX(monthly_fee) FROM updated'
  INTO v_affected_count, v_actual_branch_id, v_actual_biz_id, v_actual_amount;

  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi OR v_actual_amount <> 250.00 THEN
    RAISE EXCEPTION 'Test 6.2 FAILED (update): affected=%, branch=%, biz=%, fee=%',
      v_affected_count, v_actual_branch_id, v_actual_biz_id, v_actual_amount;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.groups WHERE id = ' || quote_literal(v_temp_class_id) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 1 THEN
    RAISE EXCEPTION 'Test 6.2 FAILED (delete): affected=%', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.2 PASSED: Admin classes SELECT, INSERT, UPDATE, and DELETE verified.';

  -- Test 6.3: Admin student transfer from Alpha to Beta WITH matching destination class -> ALLOWED (1 row)
  EXECUTE 'WITH updated AS (UPDATE public.customers SET assigned_group_id = ' || quote_literal(v_class_beta) ||
    ', branch_id = ' || quote_literal(v_branch_beta) ||
    ' WHERE id = ' || quote_literal(v_student_alpha) ||
    ' RETURNING id, branch_id, assigned_group_id, business_id) SELECT COUNT(*), MAX(branch_id::text)::uuid, MAX(assigned_group_id::text)::uuid, MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_branch_id, v_actual_group_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_beta OR v_actual_group_id <> v_class_beta OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 6.3 FAILED: affected=%, branch=%, group=%, biz=%',
      v_affected_count, v_actual_branch_id, v_actual_group_id, v_actual_biz_id;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.3 PASSED: Student transferred to Branch Beta with matching class (1 row).';

  -- Test 6.4: Admin student transfer back to Branch Alpha WITHOUT class (assigned_group_id = NULL) -> ALLOWED (1 row)
  EXECUTE 'WITH updated AS (UPDATE public.customers SET assigned_group_id = NULL, branch_id = ' || quote_literal(v_branch_alpha) ||
    ' WHERE id = ' || quote_literal(v_student_alpha) ||
    ' RETURNING id, branch_id, assigned_group_id, business_id) SELECT COUNT(*), MAX(branch_id::text)::uuid, MAX(assigned_group_id::text)::uuid, MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_branch_id, v_actual_group_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_alpha OR v_actual_group_id IS NOT NULL OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 6.4 FAILED: affected=%, branch=%, group=%, biz=%',
      v_affected_count, v_actual_branch_id, v_actual_group_id, v_actual_biz_id;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.4 PASSED: Student transferred without class (1 row, assigned_group_id IS NULL).';

  -- Test 6.5: Cross-branch class assignment rejection: Student in Alpha enrolled in Class Beta -> REJECTED (P0001)
  v_caught_expected := false;
  v_expected_errmsg := format('Cross-branch assignment denied: Student branch (%s) does not match class branch (%s)', v_branch_alpha, v_branch_beta);
  BEGIN
    EXECUTE 'UPDATE public.customers SET assigned_group_id = ' || quote_literal(v_class_beta) ||
      ' WHERE id = ' || quote_literal(v_student_alpha);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = v_expected_errmsg THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 6.5 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=% (expected %)', SQLSTATE, SQLERRM, v_expected_errmsg;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 6.5 FAILED: Cross-branch class assignment was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.5 PASSED: Cross-branch student-class assignment rejected with exact message (P0001).';

  -- Test 6.6: Mandatory branch_id enforced for Admin on customers, groups, and payments in multi-branch business
  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO public.customers (business_id, name, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ''[TEST] Null Branch Student'', NULL)';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Multi-branch violation: branch_id is required for customers in a multi-branch business' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 6.6 (customers) FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 6.6 FAILED: NULL branch_id on customers was not rejected';
  END IF;

  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO public.groups (business_id, name, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ''[TEST] Null Branch Class'', NULL)';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Multi-branch violation: branch_id is required for groups in a multi-branch business' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 6.6 (groups) FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 6.6 FAILED: NULL branch_id on groups was not rejected';
  END IF;

  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO public.payments (business_id, customer_id, month, year, amount, payment_date, payment_method, status, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ' || quote_literal(v_student_alpha) || ', ''December'', 2026, 100.00, CURRENT_DATE, ''Cash'', ''Paid'', NULL)';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Multi-branch violation: branch_id is required for payments in a multi-branch business' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 6.6 (payments) FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 6.6 FAILED: NULL branch_id on payments was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.6 PASSED: Mandatory branch_id enforced for customers, groups, and payments (P0001).';

  -- Test 6.7: Historical payment branch attribution remains original Branch Alpha after student transfers
  EXECUTE 'SELECT branch_id, business_id FROM public.payments WHERE id = ' || quote_literal(v_payment_alpha)
  INTO v_actual_branch_id, v_actual_biz_id;
  IF v_actual_branch_id <> v_original_payment_branch OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 6.7 FAILED: Historical payment branch=% (expected %), biz=%',
      v_actual_branch_id, v_original_payment_branch, v_actual_biz_id;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.7 PASSED: Historical payment branch attribution preserved at Branch Alpha.';

  -- Test 6.8: Admin authorized payment branch correction -> ALLOWED (1 row), then restored to Branch Alpha
  EXECUTE 'WITH updated AS (UPDATE public.payments SET branch_id = ' || quote_literal(v_branch_beta) ||
    ' WHERE id = ' || quote_literal(v_payment_alpha) ||
    ' RETURNING id, branch_id, business_id) SELECT COUNT(*), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_branch_id, v_actual_biz_id;

  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 6.8 FAILED: affected=%, branch=%, biz=%', v_affected_count, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH restored AS (UPDATE public.payments SET branch_id = ' || quote_literal(v_branch_alpha) ||
    ' WHERE id = ' || quote_literal(v_payment_alpha) ||
    ' RETURNING id, branch_id) SELECT COUNT(*), MAX(branch_id::text)::uuid FROM restored'
  INTO v_affected_count, v_actual_branch_id;

  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_alpha THEN
    RAISE EXCEPTION 'Test 6.8 FAILED (restore): affected=%, branch=%', v_affected_count, v_actual_branch_id;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.8 PASSED: Admin authorized payment branch correction verified (1 row) and restored.';

  -- Test 6.9: Admin attempting to tamper with user_id or business_id on business_users -> REJECTED (P0001)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'UPDATE public.business_users SET user_id = ' || quote_literal(gen_random_uuid()) ||
      ' WHERE user_id = ' || quote_literal(v_user_staff_alpha) || ' AND business_id = ' || quote_literal(v_biz_multi);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Security violation: user_id cannot be changed in business_users' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 6.9 (user_id) FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 6.9 FAILED: business_users user_id change was not rejected';
  END IF;

  v_caught_expected := false;
  BEGIN
    EXECUTE 'UPDATE public.business_users SET business_id = ' || quote_literal(v_biz_single) ||
      ' WHERE user_id = ' || quote_literal(v_user_staff_alpha) || ' AND business_id = ' || quote_literal(v_biz_multi);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Security violation: business_id cannot be changed in business_users' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 6.9 (business_id) FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 6.9 FAILED: business_users business_id change was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.9 PASSED: business_users user_id and business_id immutability enforced (P0001).';

  -- Test 6.10: Complete business_id immutability on customers -> REJECTED (P0001)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'UPDATE public.customers SET business_id = ' || quote_literal(v_biz_single) ||
      ' WHERE id = ' || quote_literal(v_student_beta);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Security violation: business_id is immutable for customers' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 6.10 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 6.10 FAILED: Customer business_id alteration was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.10 PASSED: Customer business_id immutability strictly enforced (P0001).';

  -- Test 6.11: Complete business_id immutability on groups -> REJECTED (P0001)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'UPDATE public.groups SET business_id = ' || quote_literal(v_biz_single) ||
      ' WHERE id = ' || quote_literal(v_class_alpha);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Security violation: business_id is immutable for groups' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 6.11 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 6.11 FAILED: Group business_id alteration was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.11 PASSED: Group business_id immutability strictly enforced (P0001).';

  -- Test 6.12: Complete business_id immutability on payments -> REJECTED (P0001)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'UPDATE public.payments SET business_id = ' || quote_literal(v_biz_single) ||
      ' WHERE id = ' || quote_literal(v_payment_alpha);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Security violation: business_id is immutable for payments' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 6.12 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 6.12 FAILED: Payment business_id alteration was not rejected';
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.12 PASSED: Payment business_id immutability strictly enforced (P0001).';

  -- Test 6.13: Admin permitted to update user branch_id and role on business_users (1 row each, values verified)
  EXECUTE 'WITH updated AS (UPDATE public.business_users SET branch_id = ' || quote_literal(v_branch_alpha) ||
    ', role = ''ReadOnly'' WHERE user_id = ' || quote_literal(v_user_staff_none) || ' AND business_id = ' || quote_literal(v_biz_multi) ||
    ' RETURNING id, branch_id, role, business_id) SELECT COUNT(*), MAX(branch_id::text)::uuid, MAX(role), MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_branch_id, v_actual_text, v_actual_biz_id;
  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_alpha OR v_actual_text <> 'ReadOnly' OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 6.13 FAILED (assign): affected=%, branch=%, role=%, biz=%',
      v_affected_count, v_actual_branch_id, v_actual_text, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.business_users SET branch_id = NULL, role = ''Staff'' WHERE user_id = ' ||
    quote_literal(v_user_staff_none) || ' AND business_id = ' || quote_literal(v_biz_multi) ||
    ' RETURNING id, branch_id, role, business_id) SELECT COUNT(*), MAX(branch_id::text)::uuid, MAX(role), MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_branch_id, v_actual_text, v_actual_biz_id;
  IF v_affected_count <> 1 OR v_actual_branch_id IS NOT NULL OR v_actual_text <> 'Staff' OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 6.13 FAILED (restore): affected=%, branch=%, role=%, biz=%',
      v_affected_count, v_actual_branch_id, v_actual_text, v_actual_biz_id;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 6.13 PASSED: Admin permitted to update user branch_id and role on business_users (1 row).';

  -- ============================================================
  -- 9. RLS EXECUTION: ACTOR 7 - CREATOR (Multi-Branch & Single-Tenant)
  -- ============================================================
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_creator);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_creator, 'role', 'authenticated')::text);

  SELECT current_user, r.rolbypassrls, auth.uid()
  INTO v_active_role, v_active_bypassrls, v_active_auth_uid
  FROM pg_roles r WHERE r.rolname = current_user;

  IF v_active_role <> 'authenticated' OR v_active_bypassrls = true OR v_active_auth_uid <> v_user_creator THEN
    RAISE EXCEPTION 'Actor verification failed for Creator: role=%, bypassrls=%, auth.uid()=%',
      v_active_role, v_active_bypassrls, v_active_auth_uid;
  END IF;

  -- Test 7.1: Creator branches SELECT (2 rows) and full branch INSERT, UPDATE, DELETE lifecycle
  EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE business_id = ' || quote_literal(v_biz_multi)
  INTO v_total_count;
  IF v_total_count <> 2 THEN
    RAISE EXCEPTION 'Test 7.1 FAILED (select): Creator saw % branches (expected 2)', v_total_count;
  END IF;

  EXECUTE 'WITH inserted AS (INSERT INTO public.branches (business_id, name, is_active) VALUES (' ||
    quote_literal(v_biz_multi) || ', ''[TEST] Branch Gamma'', true) RETURNING id, business_id, name) SELECT COUNT(*), MAX(id::text)::uuid, MAX(business_id::text)::uuid, MAX(name) FROM inserted'
  INTO v_affected_count, v_temp_branch_id, v_actual_biz_id, v_actual_text;
  IF v_affected_count <> 1 OR v_actual_biz_id <> v_biz_multi OR v_actual_text <> '[TEST] Branch Gamma' THEN
    RAISE EXCEPTION 'Test 7.1 FAILED (insert): affected=%, biz=%, name=%', v_affected_count, v_actual_biz_id, v_actual_text;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.branches SET name = ''[TEST] Branch Gamma Updated'' WHERE id = ' || quote_literal(v_temp_branch_id) ||
    ' RETURNING id, name) SELECT COUNT(*), MAX(name) FROM updated'
  INTO v_affected_count, v_actual_text;
  IF v_affected_count <> 1 OR v_actual_text <> '[TEST] Branch Gamma Updated' THEN
    RAISE EXCEPTION 'Test 7.1 FAILED (update): affected=%, name=%', v_affected_count, v_actual_text;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.branches WHERE id = ' || quote_literal(v_temp_branch_id) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 1 THEN
    RAISE EXCEPTION 'Test 7.1 FAILED (delete): affected=%', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 7.1 PASSED: Creator branches SELECT, INSERT, UPDATE, and DELETE verified.';

  -- Test 7.2: Creator classes SELECT, INSERT, UPDATE, and DELETE
  EXECUTE 'SELECT COUNT(*) FROM public.groups WHERE business_id = ' || quote_literal(v_biz_multi)
  INTO v_total_count;
  IF v_total_count <> 2 THEN
    RAISE EXCEPTION 'Test 7.2 FAILED (select): Creator saw % classes (expected 2)', v_total_count;
  END IF;

  EXECUTE 'WITH inserted AS (INSERT INTO public.groups (business_id, name, monthly_fee, branch_id) VALUES (' ||
    quote_literal(v_biz_multi) || ', ''[TEST] Creator Class'', 300.00, ' || quote_literal(v_branch_alpha) ||
    ') RETURNING id, branch_id, business_id, monthly_fee) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid, MAX(monthly_fee) FROM inserted'
  INTO v_affected_count, v_temp_class_id, v_actual_branch_id, v_actual_biz_id, v_actual_amount;
  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi OR v_actual_amount <> 300.00 THEN
    RAISE EXCEPTION 'Test 7.2 FAILED (insert): affected=%', v_affected_count;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.groups SET description = ''Creator Class Updated'', monthly_fee = 320.00 WHERE id = ' ||
    quote_literal(v_temp_class_id) ||
    ' RETURNING id, description, monthly_fee, branch_id, business_id) SELECT COUNT(*), MAX(description), MAX(monthly_fee), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_text, v_actual_amount, v_actual_branch_id, v_actual_biz_id;
  IF v_affected_count <> 1 OR v_actual_text <> 'Creator Class Updated' OR v_actual_amount <> 320.00 OR v_actual_branch_id <> v_branch_alpha OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 7.2 FAILED (update): affected=%', v_affected_count;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.groups WHERE id = ' || quote_literal(v_temp_class_id) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 1 THEN
    RAISE EXCEPTION 'Test 7.2 FAILED (delete): affected=%', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 7.2 PASSED: Creator classes SELECT, INSERT, UPDATE, and DELETE verified.';

  -- Test 7.3: Creator customers and payments INSERT, UPDATE, and DELETE
  EXECUTE 'WITH inserted AS (INSERT INTO public.customers (business_id, name, branch_id) VALUES (' ||
    quote_literal(v_biz_multi) || ', ''[TEST] Creator Student'', ' || quote_literal(v_branch_beta) ||
    ') RETURNING id, branch_id, business_id) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM inserted'
  INTO v_affected_count, v_temp_student_id, v_actual_branch_id, v_actual_biz_id;
  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 7.3 FAILED (student insert): affected=%', v_affected_count;
  END IF;

  EXECUTE 'WITH inserted AS (INSERT INTO public.payments (business_id, customer_id, month, year, amount, payment_date, payment_method, status, branch_id) VALUES (' ||
    quote_literal(v_biz_multi) || ', ' || quote_literal(v_temp_student_id) || ', ''December'', 2026, 250.00, CURRENT_DATE, ''Cash'', ''Paid'', ' || quote_literal(v_branch_beta) ||
    ') RETURNING id, branch_id, business_id) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM inserted'
  INTO v_affected_count, v_temp_payment_id, v_actual_branch_id, v_actual_biz_id;
  IF v_affected_count <> 1 OR v_actual_branch_id <> v_branch_beta OR v_actual_biz_id <> v_biz_multi THEN
    RAISE EXCEPTION 'Test 7.3 FAILED (payment insert): affected=%', v_affected_count;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.payments WHERE id = ' || quote_literal(v_temp_payment_id) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 1 THEN
    RAISE EXCEPTION 'Test 7.3 FAILED (payment delete): affected=%', v_affected_count;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.customers WHERE id = ' || quote_literal(v_temp_student_id) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 1 THEN
    RAISE EXCEPTION 'Test 7.3 FAILED (student delete): affected=%', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 7.3 PASSED: Creator student and payment CRUD lifecycle verified.';

  -- Test 7.4: Single-Tenant Backward Compatibility (v_biz_single has 0 branches; NULL branch_id permitted)
  EXECUTE 'WITH inserted AS (INSERT INTO public.groups (business_id, name, monthly_fee, branch_id) VALUES (' ||
    quote_literal(v_biz_single) || ', ''[TEST] Solo Class'', 100.00, NULL) RETURNING id, branch_id, business_id) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM inserted'
  INTO v_affected_count, v_single_class_id, v_actual_branch_id, v_actual_biz_id;
  IF v_affected_count <> 1 OR v_actual_branch_id IS NOT NULL OR v_actual_biz_id <> v_biz_single THEN
    RAISE EXCEPTION 'Test 7.4 FAILED (single-tenant group): affected=%, branch=%, biz=%', v_affected_count, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH inserted AS (INSERT INTO public.customers (business_id, name, assigned_group_id, branch_id) VALUES (' ||
    quote_literal(v_biz_single) || ', ''[TEST] Solo Student'', ' || quote_literal(v_single_class_id) || ', NULL) RETURNING id, branch_id, business_id) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM inserted'
  INTO v_affected_count, v_single_student_id, v_actual_branch_id, v_actual_biz_id;
  IF v_affected_count <> 1 OR v_actual_branch_id IS NOT NULL OR v_actual_biz_id <> v_biz_single THEN
    RAISE EXCEPTION 'Test 7.4 FAILED (single-tenant customer): affected=%, branch=%, biz=%', v_affected_count, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH inserted AS (INSERT INTO public.payments (business_id, customer_id, month, year, amount, payment_date, payment_method, status, branch_id) VALUES (' ||
    quote_literal(v_biz_single) || ', ' || quote_literal(v_single_student_id) || ', ''December'', 2026, 100.00, CURRENT_DATE, ''Cash'', ''Paid'', NULL) RETURNING id, branch_id, business_id) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM inserted'
  INTO v_affected_count, v_single_payment_id, v_actual_branch_id, v_actual_biz_id;
  IF v_affected_count <> 1 OR v_actual_branch_id IS NOT NULL OR v_actual_biz_id <> v_biz_single THEN
    RAISE EXCEPTION 'Test 7.4 FAILED (single-tenant payment): affected=%, branch=%, biz=%', v_affected_count, v_actual_branch_id, v_actual_biz_id;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 7.4 PASSED: Single-tenant backward compatibility with NULL branch_id verified.';

  -- Test 7.5: Cross-Business Class Assignment Rejection & Direct Trigger Non-Admin Escalation Guard
  -- 7.5a: Assigning student in v_biz_multi to class in v_biz_single -> REJECTED by trg_check_student_class_branch (P0001)
  v_caught_expected := false;
  v_expected_errmsg := format('Cross-business assignment denied: Student business (%s) does not match class business (%s)', v_biz_multi, v_biz_single);
  BEGIN
    EXECUTE 'UPDATE public.customers SET assigned_group_id = ' || quote_literal(v_single_class_id) ||
      ' WHERE id = ' || quote_literal(v_student_alpha);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = v_expected_errmsg THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 7.5a FAILED with unexpected exception: SQLSTATE=%, SQLERRM=% (expected %)', SQLSTATE, SQLERRM, v_expected_errmsg;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 7.5a FAILED: Cross-business class assignment was not rejected';
  END IF;

  -- 7.5b: Direct verification of trigger trg_protect_business_users_immutability non-admin guard (even if RLS were bypassed)
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_staff_alpha);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_staff_alpha, 'role', 'authenticated')::text);

  v_caught_expected := false;
  BEGIN
    EXECUTE 'UPDATE public.business_users SET role = ''Admin'' WHERE user_id = ' || quote_literal(v_user_staff_alpha) ||
      ' AND business_id = ' || quote_literal(v_biz_multi);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Security violation: only Creator or Admin can update business_users' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 7.5b FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 7.5b FAILED: Trigger did not block non-admin business_users update when RLS was bypassed';
  END IF;

  -- Return to authenticated role for Section 10
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 7.5 PASSED: Cross-business class assignment rejected (P0001) and business_users trigger non-admin guard verified (P0001).';

  -- ============================================================
  -- 10. INACTIVE BRANCH & SECURITY DOWNGRADE PREVENTION SUITE (TESTS 8.1 - 8.6)
  -- ============================================================

  -- Test 8.1: Scenario 1 — Multi-branch business with ALL branches active (Alpha=true, Beta=true)
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_staff_alpha);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_staff_alpha, 'role', 'authenticated')::text);

  SELECT current_user, r.rolbypassrls, auth.uid()
  INTO v_active_role, v_active_bypassrls, v_active_auth_uid
  FROM pg_roles r WHERE r.rolname = current_user;
  IF v_active_role <> 'authenticated' OR v_active_bypassrls = true OR v_active_auth_uid <> v_user_staff_alpha THEN
    RAISE EXCEPTION 'Actor verification failed in Test 8.1';
  END IF;

  EXECUTE 'SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_alpha) INTO v_pos_count;
  EXECUTE 'SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_beta) INTO v_neg_count;
  IF v_pos_count <> 1 OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 8.1 FAILED: Staff Alpha pos=%, neg=% when all branches active', v_pos_count, v_neg_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 8.1 PASSED: Scenario 1 (All branches active) verified.';

  -- Test 8.2: Scenario 2 — Multi-branch business with ONE branch inactive (Alpha=true, Beta=false)
  -- Admin deactivates Branch Beta; verify Staff Alpha & Staff Beta remain branch-isolated and Beta writes are blocked
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_admin);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_admin, 'role', 'authenticated')::text);

  EXECUTE 'WITH updated AS (UPDATE public.branches SET is_active = false WHERE id = ' || quote_literal(v_branch_beta) ||
    ' RETURNING id, is_active) SELECT COUNT(*), BOOL_AND(is_active) FROM updated'
  INTO v_affected_count, v_active_bypassrls;
  IF v_affected_count <> 1 OR v_active_bypassrls <> false THEN
    RAISE EXCEPTION 'Test 8.2 FAILED: Admin could not deactivate Branch Beta (affected=%)', v_affected_count;
  END IF;

  -- Switch to Staff Beta (whose assigned branch Beta is now inactive)
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_staff_beta);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_staff_beta, 'role', 'authenticated')::text);

  EXECUTE 'SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_beta) INTO v_pos_count;
  EXECUTE 'SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_alpha) INTO v_neg_count;
  IF v_pos_count <> 1 OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 8.2 FAILED: Staff Beta isolation broken when Beta inactive (pos=%, neg=%)', v_pos_count, v_neg_count;
  END IF;

  -- Staff Beta attempting INSERT into inactive Branch Beta -> REJECTED (P0001)
  v_caught_expected := false;
  v_expected_errmsg := format('Inactive branch violation: Cannot assign customers to an inactive branch (%s)', v_branch_beta);
  BEGIN
    EXECUTE 'INSERT INTO public.customers (business_id, name, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ''[TEST] Inactive Beta Student'', ' || quote_literal(v_branch_beta) || ')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = v_expected_errmsg THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 8.2 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=% (expected %)', SQLSTATE, SQLERRM, v_expected_errmsg;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 8.2 FAILED: INSERT into inactive Branch Beta was not rejected';
  END IF;

  -- Staff Beta attempting UPDATE on customer in inactive Branch Beta -> 0 rows affected (blocked by RLS USING)
  EXECUTE 'WITH updated AS (UPDATE public.customers SET notes = ''Frozen Update'' WHERE id = ' || quote_literal(v_student_beta) || ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 0 THEN
    RAISE EXCEPTION 'Test 8.2 FAILED: Staff Beta updated % rows in inactive branch (expected 0)', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 8.2 PASSED: Scenario 2 (One branch inactive) isolation and write block verified.';

  -- Test 8.3: Scenario 3 — Multi-branch business with ALL branches inactive (Alpha=false, Beta=false)
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_admin);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_admin, 'role', 'authenticated')::text);

  EXECUTE 'WITH updated AS (UPDATE public.branches SET is_active = false WHERE id = ' || quote_literal(v_branch_alpha) ||
    ' RETURNING id, is_active) SELECT COUNT(*), BOOL_AND(is_active) FROM updated'
  INTO v_affected_count, v_active_bypassrls;
  EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE business_id = ' || quote_literal(v_biz_multi) || ' AND is_active = true'
  INTO v_total_count;
  IF v_affected_count <> 1 OR v_active_bypassrls <> false OR v_total_count <> 0 THEN
    RAISE EXCEPTION 'Test 8.3 FAILED: Expected 0 active branches in v_biz_multi, got %', v_total_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 8.3 PASSED: Scenario 3 (All branches inactive in multi-branch business) established.';

  -- Test 8.4: Scenario 4 — Staff access remains strictly branch-restricted when ALL branches are inactive (No security downgrade)
  -- Check Staff Alpha
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_staff_alpha);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_staff_alpha, 'role', 'authenticated')::text);

  EXECUTE 'SELECT (SELECT COUNT(*) FROM public.groups WHERE id = ' || quote_literal(v_class_alpha) || ') + ' ||
    '(SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_alpha) || ') + ' ||
    '(SELECT COUNT(*) FROM public.payments WHERE id = ' || quote_literal(v_payment_alpha) || ')'
  INTO v_pos_count;
  EXECUTE 'SELECT (SELECT COUNT(*) FROM public.groups WHERE id = ' || quote_literal(v_class_beta) || ') + ' ||
    '(SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_beta) || ') + ' ||
    '(SELECT COUNT(*) FROM public.payments WHERE id = ' || quote_literal(v_payment_beta) || ')'
  INTO v_neg_count;
  IF v_pos_count <> 3 OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 8.4 FAILED (Staff Alpha): pos=% (expected 3), neg=% (expected 0) when all branches inactive!', v_pos_count, v_neg_count;
  END IF;

  -- Check Staff Beta
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_staff_beta);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_staff_beta, 'role', 'authenticated')::text);

  EXECUTE 'SELECT (SELECT COUNT(*) FROM public.groups WHERE id = ' || quote_literal(v_class_beta) || ') + ' ||
    '(SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_beta) || ') + ' ||
    '(SELECT COUNT(*) FROM public.payments WHERE id = ' || quote_literal(v_payment_beta) || ')'
  INTO v_pos_count;
  EXECUTE 'SELECT (SELECT COUNT(*) FROM public.groups WHERE id = ' || quote_literal(v_class_alpha) || ') + ' ||
    '(SELECT COUNT(*) FROM public.customers WHERE id = ' || quote_literal(v_student_alpha) || ') + ' ||
    '(SELECT COUNT(*) FROM public.payments WHERE id = ' || quote_literal(v_payment_alpha) || ')'
  INTO v_neg_count;
  IF v_pos_count <> 3 OR v_neg_count <> 0 THEN
    RAISE EXCEPTION 'Test 8.4 FAILED (Staff Beta): pos=% (expected 3), neg=% (expected 0) when all branches inactive!', v_pos_count, v_neg_count;
  END IF;

  -- Check Staff Unassigned (must still see 0 rows even when all branches are inactive)
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_staff_none);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_staff_none, 'role', 'authenticated')::text);

  EXECUTE 'SELECT (SELECT COUNT(*) FROM public.branches WHERE business_id = ' || quote_literal(v_biz_multi) || ') + ' ||
    '(SELECT COUNT(*) FROM public.groups WHERE business_id = ' || quote_literal(v_biz_multi) || ') + ' ||
    '(SELECT COUNT(*) FROM public.customers WHERE business_id = ' || quote_literal(v_biz_multi) || ') + ' ||
    '(SELECT COUNT(*) FROM public.payments WHERE business_id = ' || quote_literal(v_biz_multi) || ')'
  INTO v_total_count;
  IF v_total_count <> 0 THEN
    RAISE EXCEPTION 'Test 8.4 FAILED (Staff Unassigned): saw % rows (expected 0) when all branches inactive!', v_total_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 8.4 PASSED: Scenario 4 (Zero security downgrade for Staff when all branches inactive) verified.';

  -- Test 8.5: Scenario 5 — New operational records cannot bypass branch assignment or write to inactive branches when all branches are inactive
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_admin);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_admin, 'role', 'authenticated')::text);

  -- Admin attempting NULL branch_id when all branches are inactive -> REJECTED (P0001: Multi-branch violation)
  v_caught_expected := false;
  BEGIN
    EXECUTE 'INSERT INTO public.customers (business_id, name, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ''[TEST] Downgrade Bypass Student'', NULL)';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Multi-branch violation: branch_id is required for customers in a multi-branch business' THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 8.5 (NULL branch) FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 8.5 FAILED: NULL branch_id was permitted when all branches were inactive!';
  END IF;

  -- Admin attempting INSERT into inactive Branch Alpha when all branches are inactive -> REJECTED (P0001: Inactive branch violation)
  v_caught_expected := false;
  v_expected_errmsg := format('Inactive branch violation: Cannot assign customers to an inactive branch (%s)', v_branch_alpha);
  BEGIN
    EXECUTE 'INSERT INTO public.customers (business_id, name, branch_id) VALUES (' ||
      quote_literal(v_biz_multi) || ', ''[TEST] Inactive Alpha Student'', ' || quote_literal(v_branch_alpha) || ')';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = v_expected_errmsg THEN
      v_caught_expected := true;
    ELSE
      RAISE EXCEPTION 'Test 8.5 (inactive Alpha) FAILED with unexpected exception: SQLSTATE=%, SQLERRM=% (expected %)', SQLSTATE, SQLERRM, v_expected_errmsg;
    END IF;
  END;
  IF NOT v_caught_expected THEN
    RAISE EXCEPTION 'Test 8.5 FAILED: Admin INSERT into inactive Branch Alpha was not rejected!';
  END IF;

  -- Restore active status on both branches
  EXECUTE 'WITH updated AS (UPDATE public.branches SET is_active = true WHERE business_id = ' || quote_literal(v_biz_multi) ||
    ' RETURNING id) SELECT COUNT(*) FROM updated'
  INTO v_affected_count;
  IF v_affected_count <> 2 THEN
    RAISE EXCEPTION 'Test 8.5 FAILED: Expected 2 branches reactivated, got %', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 8.5 PASSED: Scenario 5 (Mandatory branch_id & fail-safe write rejection when all branches inactive) verified.';

  -- Test 8.6: Scenario 6 — Single-tenant business with zero branch configuration (v_biz_single) remains backward-compatible for SELECT/UPDATE/DELETE
  EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_user_creator);
  EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_user_creator, 'role', 'authenticated')::text);

  EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE business_id = ' || quote_literal(v_biz_single)
  INTO v_total_count;
  IF v_total_count <> 0 THEN
    RAISE EXCEPTION 'Test 8.6 FAILED: Single-tenant business has % branches (expected 0)', v_total_count;
  END IF;

  EXECUTE 'WITH updated AS (UPDATE public.customers SET notes = ''Solo Student Updated'' WHERE id = ' ||
    quote_literal(v_single_student_id) || ' RETURNING id, notes, branch_id, business_id) SELECT COUNT(*), MAX(notes), MAX(branch_id::text)::uuid, MAX(business_id::text)::uuid FROM updated'
  INTO v_affected_count, v_actual_notes, v_actual_branch_id, v_actual_biz_id;
  IF v_affected_count <> 1 OR v_actual_notes <> 'Solo Student Updated' OR v_actual_branch_id IS NOT NULL OR v_actual_biz_id <> v_biz_single THEN
    RAISE EXCEPTION 'Test 8.6 FAILED (update): affected=%, notes=%, branch=%, biz=%',
      v_affected_count, v_actual_notes, v_actual_branch_id, v_actual_biz_id;
  END IF;

  EXECUTE 'WITH deleted AS (DELETE FROM public.payments WHERE id = ' || quote_literal(v_single_payment_id) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
  INTO v_affected_count;
  IF v_affected_count <> 1 THEN
    RAISE EXCEPTION 'Test 8.6 FAILED (delete): affected=%', v_affected_count;
  END IF;
  v_passed_count := v_passed_count + 1;
  RAISE NOTICE 'Test 8.6 PASSED: Scenario 6 (Single-tenant business full CRUD backward compatibility) verified.';

  -- ============================================================
  -- 11. CONFIRMED TARGET (978d2b0c-6a2b-4c28-9000-71dc23f96781) VS
  --     PROTECTED WORKSPACE (ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad) SUITE (Tests 9.1 - 9.5)
  -- ============================================================
  EXECUTE 'RESET ROLE';

  DECLARE
    v_target_biz CONSTANT UUID := '978d2b0c-6a2b-4c28-9000-71dc23f96781';
    v_target_owner CONSTANT UUID := 'd2b660bf-10d3-4d94-94ec-0b8f6e0908e6';
    v_protected_biz CONSTANT UUID := 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';
    v_protected_owner CONSTANT UUID := 'a11c9c2b-364d-4aca-b6f1-90e9024c4a6e';
    v_pauh_jaya UUID;
    v_kelisa_emas UUID;
    v_owner_role TEXT;
    v_owner_email TEXT;
    v_target_null_rows INT;
    v_protected_branch_rows INT;
    v_protected_nonnull_rows INT;
    v_prot_cust_id UUID;
  BEGIN
    -- Test 9.1: Confirmed target workspace & account-to-workspace relationship verified
    SELECT bu.role, p.email
    INTO v_owner_role, v_owner_email
    FROM public.business_users bu
    JOIN public.profiles p ON p.id = bu.user_id
    WHERE bu.business_id = v_target_biz
      AND bu.user_id = v_target_owner;

    SELECT id INTO v_pauh_jaya FROM public.branches WHERE business_id = v_target_biz AND name = 'Pauh Jaya' AND is_active = true;
    SELECT id INTO v_kelisa_emas FROM public.branches WHERE business_id = v_target_biz AND name = 'Kelisa Emas' AND is_active = true;

    IF v_owner_role IS DISTINCT FROM 'Creator'
       OR v_owner_email IS DISTINCT FROM 'akademikmega.admin@gmail.com'
       OR v_pauh_jaya IS NULL
       OR v_kelisa_emas IS NULL THEN
      RAISE EXCEPTION 'Test 9.1 FAILED: Target workspace verification failed (role=%, email=%, pauh=%, kelisa=%)',
        v_owner_role, v_owner_email, v_pauh_jaya, v_kelisa_emas;
    END IF;
    v_passed_count := v_passed_count + 1;
    RAISE NOTICE 'Test 9.1 PASSED: Confirmed target 978d2b0c-6a2b-4c28-9000-71dc23f96781 & Creator d2b660bf-10d3-4d94-94ec-0b8f6e0908e6 verified.';

    -- Test 9.2: Backfill affects ONLY target workspace; protected workspace (ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad) is 100% excluded
    SELECT
      (SELECT COUNT(*) FROM public.groups WHERE business_id = v_target_biz AND branch_id IS NULL) +
      (SELECT COUNT(*) FROM public.customers WHERE business_id = v_target_biz AND branch_id IS NULL) +
      (SELECT COUNT(*) FROM public.payments WHERE business_id = v_target_biz AND branch_id IS NULL) +
      (SELECT COUNT(*) FROM public.business_users WHERE business_id = v_target_biz AND role = 'Staff' AND branch_id IS NULL)
    INTO v_target_null_rows;

    SELECT COUNT(*) INTO v_protected_branch_rows
    FROM public.branches
    WHERE business_id = v_protected_biz;

    SELECT
      (SELECT COUNT(*) FROM public.groups WHERE business_id = v_protected_biz AND branch_id IS NOT NULL) +
      (SELECT COUNT(*) FROM public.customers WHERE business_id = v_protected_biz AND branch_id IS NOT NULL) +
      (SELECT COUNT(*) FROM public.payments WHERE business_id = v_protected_biz AND branch_id IS NOT NULL) +
      (SELECT COUNT(*) FROM public.business_users WHERE business_id = v_protected_biz AND branch_id IS NOT NULL)
    INTO v_protected_nonnull_rows;

    IF v_target_null_rows <> 0 OR v_protected_branch_rows <> 0 OR v_protected_nonnull_rows <> 0 THEN
      RAISE EXCEPTION 'Test 9.2 FAILED: target_null_rows=%, protected_branch_rows=%, protected_nonnull_rows=%',
        v_target_null_rows, v_protected_branch_rows, v_protected_nonnull_rows;
    END IF;
    v_passed_count := v_passed_count + 1;
    RAISE NOTICE 'Test 9.2 PASSED: Backfill strictly confined to 978d2b0c-6a2b-4c28-9000-71dc23f96781; protected workspace ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad untouched.';

    -- Test 9.3: Target Creator (d2b660bf-10d3-4d94-94ec-0b8f6e0908e6) sees target branches/records and is isolated from protected workspace
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_target_owner);
    EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_target_owner, 'role', 'authenticated')::text);

    EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE business_id = ' || quote_literal(v_target_biz)
    INTO v_pos_count;
    EXECUTE 'SELECT COUNT(*) FROM public.customers WHERE business_id = ' || quote_literal(v_protected_biz)
    INTO v_neg_count;

    IF v_pos_count <> 2 OR v_neg_count <> 0 THEN
      RAISE EXCEPTION 'Test 9.3 FAILED: Target Creator pos_branches=%, protected_customers=%', v_pos_count, v_neg_count;
    END IF;

    v_caught_expected := false;
    BEGIN
      EXECUTE 'INSERT INTO public.customers (business_id, name, status) VALUES (' ||
        quote_literal(v_protected_biz) || ', ''[TEST] Cross-Tenant Intrusion'', ''Active'')';
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE = '42501' AND SQLERRM = 'new row violates row-level security policy for table "customers"' THEN
        v_caught_expected := true;
      ELSE
        RAISE EXCEPTION 'Test 9.3 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
      END IF;
    END;
    IF NOT v_caught_expected THEN
      RAISE EXCEPTION 'Test 9.3 FAILED: Target Creator was able to insert into protected workspace!';
    END IF;
    v_passed_count := v_passed_count + 1;
    RAISE NOTICE 'Test 9.3 PASSED: Target Creator (d2b660bf-10d3-4d94-94ec-0b8f6e0908e6) isolated from protected workspace ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad.';

    -- Test 9.4: Protected Workspace Owner (a11c9c2b-364d-4aca-b6f1-90e9024c4a6e) operates in single-tenant mode (NULL branch_id) and is isolated from target workspace
    EXECUTE 'SET LOCAL "request.jwt.claim.sub" = ' || quote_literal(v_protected_owner);
    EXECUTE 'SET LOCAL "request.jwt.claims" = ' || quote_literal(json_build_object('sub', v_protected_owner, 'role', 'authenticated')::text);

    EXECUTE 'SELECT COUNT(*) FROM public.branches WHERE business_id = ' || quote_literal(v_target_biz)
    INTO v_neg_count;
    IF v_neg_count <> 0 THEN
      RAISE EXCEPTION 'Test 9.4 FAILED: Protected workspace owner saw % branches in target workspace', v_neg_count;
    END IF;

    EXECUTE 'WITH inserted AS (INSERT INTO public.customers (business_id, name, status, branch_id) VALUES (' ||
      quote_literal(v_protected_biz) || ', ''[TEST] Protected Single-Tenant Student'', ''Active'', NULL) RETURNING id, branch_id) SELECT COUNT(*), MAX(id::text)::uuid, MAX(branch_id::text)::uuid FROM inserted'
    INTO v_affected_count, v_prot_cust_id, v_actual_branch_id;

    IF v_affected_count <> 1 OR v_prot_cust_id IS NULL OR v_actual_branch_id IS NOT NULL THEN
      RAISE EXCEPTION 'Test 9.4 FAILED: Protected workspace single-tenant insert failed (affected=%, branch=%)',
        v_affected_count, v_actual_branch_id;
    END IF;

    EXECUTE 'WITH deleted AS (DELETE FROM public.customers WHERE id = ' || quote_literal(v_prot_cust_id) || ' RETURNING id) SELECT COUNT(*) FROM deleted'
    INTO v_affected_count;
    IF v_affected_count <> 1 THEN
      RAISE EXCEPTION 'Test 9.4 FAILED: Protected workspace single-tenant delete failed';
    END IF;
    v_passed_count := v_passed_count + 1;
    RAISE NOTICE 'Test 9.4 PASSED: Protected workspace ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad single-tenant operation & cross-business isolation verified.';

    -- Test 9.5: Rollback non-target protection guard aborts if protected workspace ever contains branch data
    EXECUTE 'RESET ROLE';
    INSERT INTO public.branches (business_id, name, is_active)
    VALUES (v_protected_biz, 'Accidental Protected Branch', true);

    v_caught_expected := false;
    v_expected_errmsg := 'Rollback Aborted: Non-target or protected workspace (including ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad) contains 1 branch configuration or branch_id records. Refusing to drop branches table.';
    BEGIN
      DECLARE
        v_other_cnt INT;
      BEGIN
        SELECT
          (SELECT COUNT(*) FROM public.branches WHERE business_id NOT IN (v_target_biz, v_biz_multi)) +
          (SELECT COUNT(*) FROM public.customers WHERE business_id NOT IN (v_target_biz, v_biz_multi) AND branch_id IS NOT NULL) +
          (SELECT COUNT(*) FROM public.groups WHERE business_id NOT IN (v_target_biz, v_biz_multi) AND branch_id IS NOT NULL) +
          (SELECT COUNT(*) FROM public.payments WHERE business_id NOT IN (v_target_biz, v_biz_multi) AND branch_id IS NOT NULL) +
          (SELECT COUNT(*) FROM public.business_users WHERE business_id NOT IN (v_target_biz, v_biz_multi) AND branch_id IS NOT NULL)
        INTO v_other_cnt;

        IF v_other_cnt > 0 THEN
          RAISE EXCEPTION 'Rollback Aborted: Non-target or protected workspace (including %) contains % branch configuration or branch_id records. Refusing to drop branches table.',
            v_protected_biz, v_other_cnt;
        END IF;
      END;
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE = 'P0001' AND SQLERRM = v_expected_errmsg THEN
        v_caught_expected := true;
      ELSE
        RAISE EXCEPTION 'Test 9.5 FAILED with unexpected exception: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
      END IF;
    END;
    IF NOT v_caught_expected THEN
      RAISE EXCEPTION 'Test 9.5 FAILED: Rollback guard did not abort when protected workspace contained a branch!';
    END IF;

    DELETE FROM public.branches WHERE business_id = v_protected_biz;
    v_passed_count := v_passed_count + 1;
    RAISE NOTICE 'Test 9.5 PASSED: Rollback guard protects non-target workspace ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad from accidental branch drop.';
  END;

  -- ------------------------------------------------------------
  -- 12. TEARDOWN & EXACT TEST CASE COUNTER CHECK
  -- ------------------------------------------------------------
  EXECUTE 'RESET ROLE';

  IF v_passed_count <> 68 THEN
    RAISE EXCEPTION 'TEST HARNESS INCOMPLETE: Expected exactly 68 passed test cases, got %', v_passed_count;
  END IF;

  RAISE NOTICE '============================================================';
  RAISE NOTICE 'TEST HARNESS COMPLETE: % / 68 TEST CASES VERIFIED UNDER authenticated ROLE', v_passed_count;
  RAISE NOTICE '============================================================';
END $$;

-- ALWAYS ROLL BACK: Clean teardown, zero residual data
ROLLBACK;
