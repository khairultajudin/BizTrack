-- ============================================================
-- BIZTRACK MIGRATION 09 VERIFICATION & SECURITY TEST SUITE
-- ============================================================
-- Tests all 18 Phase G matrix scenarios in an isolated
-- BEGIN ... ROLLBACK transaction using SET LOCAL ROLE authenticated
-- and request.jwt.claims.
-- ============================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_target_biz_id CONSTANT UUID := '978d2b0c-6a2b-4c28-9000-71dc23f96781';
  v_protected_biz_id CONSTANT UUID := 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';
  v_hana_uid CONSTANT UUID := 'd2b660bf-10d3-4d94-94ec-0b8f6e0908e6';
  v_pauh_staff_uid CONSTANT UUID := '1d602572-2048-4526-bac0-05839ac06471';
  v_kelisa_staff_uid CONSTANT UUID := '2877f207-c3ff-4339-ad4e-823a3bd24e5f';
  v_pauh_branch_id CONSTANT UUID := '9420a109-4a28-47f3-93ff-f4be08012719';
  v_kelisa_branch_id CONSTANT UUID := 'e4f61aac-9629-4be7-ae7e-8d9b462233a4';
  v_generic_admin_uid CONSTANT UUID := 'aaaaaaaa-1111-4111-8111-111111111111';
  v_other_biz_id CONSTANT UUID := 'bbbbbbbb-2222-4222-8222-222222222222';
  v_other_branch_id CONSTANT UUID := 'cccccccc-3333-4333-8333-333333333333';

  v_t_pauh UUID;
  v_t_kelisa UUID;
  v_t_both UUID;
  v_t_unassigned UUID;
  v_count INT;
  v_branch_ids UUID[];
  v_rejected BOOLEAN;
  v_err_state TEXT;
  v_err_msg TEXT;
  v_protected_before INT;
  v_protected_after INT;
BEGIN
  -- ----------------------------------------------------------
  -- 0. Snapshot Protected Workspace & create synthetic Generic Admin + Other Business
  -- ----------------------------------------------------------
  SELECT
    (SELECT COUNT(*) FROM public.branches WHERE business_id = v_protected_biz_id) +
    (SELECT COUNT(*) FROM public.staff_branch_assignments WHERE business_id = v_protected_biz_id) +
    (SELECT COUNT(*) FROM public.staff WHERE business_id = v_protected_biz_id)
  INTO v_protected_before;

  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_generic_admin_uid, 'synthetic.admin.m09@biztrack.local', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (v_generic_admin_uid, 'synthetic.admin.m09@biztrack.local', 'Synthetic Generic Admin')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.business_users (business_id, user_id, role, branch_id)
  VALUES (v_target_biz_id, v_generic_admin_uid, 'Admin', NULL)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.businesses (id, name)
  VALUES (v_other_biz_id, 'Synthetic Other Biz M09');

  INSERT INTO public.branches (id, business_id, name, is_active)
  VALUES (v_other_branch_id, v_other_biz_id, 'Other Branch', true);

  -- ----------------------------------------------------------
  -- Switch to authenticated role as Puan Hana
  -- ----------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Test 1: Puan Hana assigns teacher to Pauh Jaya only
  v_t_pauh := public.save_teacher_with_salary(
    v_target_biz_id, 'M09 Synthetic Pauh', 'Teacher', NULL, 'Monthly', 1000, NULL, NULL, NULL,
    ARRAY[v_pauh_branch_id]
  );
  SELECT branch_ids INTO v_branch_ids FROM public.get_teachers_with_salary(v_target_biz_id) WHERE id = v_t_pauh;
  IF v_branch_ids <> ARRAY[v_pauh_branch_id] THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Expected Pauh Jaya only, got %', v_branch_ids;
  END IF;

  -- Test 2: Puan Hana assigns teacher to Kelisa Emas only
  v_t_kelisa := public.save_teacher_with_salary(
    v_target_biz_id, 'M09 Synthetic Kelisa', 'Teacher', NULL, 'Monthly', 1000, NULL, NULL, NULL,
    ARRAY[v_kelisa_branch_id]
  );
  SELECT branch_ids INTO v_branch_ids FROM public.get_teachers_with_salary(v_target_biz_id) WHERE id = v_t_kelisa;
  IF v_branch_ids <> ARRAY[v_kelisa_branch_id] THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Expected Kelisa Emas only, got %', v_branch_ids;
  END IF;

  -- Test 3: Puan Hana assigns teacher to BOTH branches (single teacher profile)
  v_t_both := public.save_teacher_with_salary(
    v_target_biz_id, 'M09 Synthetic Both', 'Teacher', NULL, 'Monthly', 1500, NULL, NULL, NULL,
    ARRAY[v_pauh_branch_id, v_kelisa_branch_id]
  );
  SELECT COUNT(*) INTO v_count FROM public.get_teachers_with_salary(v_target_biz_id) WHERE id = v_t_both;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Expected 1 teacher profile for multi-branch teacher, got %', v_count;
  END IF;
  SELECT branch_ids INTO v_branch_ids FROM public.get_teachers_with_salary(v_target_biz_id) WHERE id = v_t_both;
  IF NOT (v_pauh_branch_id = ANY(v_branch_ids) AND v_kelisa_branch_id = ANY(v_branch_ids) AND cardinality(v_branch_ids) = 2) THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Expected both branches, got %', v_branch_ids;
  END IF;

  -- Create unassigned teacher (0 branches)
  v_t_unassigned := public.save_teacher_with_salary(
    v_target_biz_id, 'M09 Synthetic Unassigned', 'Teacher', NULL, 'Monthly', 800, NULL, NULL, NULL,
    ARRAY[]::UUID[]
  );

  -- Test 4: Puan Hana removes one branch assignment and re-adds it
  v_branch_ids := public.set_teacher_branch_assignments(v_target_biz_id, v_t_both, ARRAY[v_pauh_branch_id]);
  IF v_branch_ids <> ARRAY[v_pauh_branch_id] THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Expected 1 branch after removal, got %', v_branch_ids;
  END IF;
  v_branch_ids := public.set_teacher_branch_assignments(v_target_biz_id, v_t_both, ARRAY[v_pauh_branch_id, v_kelisa_branch_id]);
  IF cardinality(v_branch_ids) <> 2 THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Expected 2 branches after re-add, got %', v_branch_ids;
  END IF;

  -- Test 10: Duplicate assignment is rejected (both via direct INSERT and RPC)
  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.staff_branch_assignments (business_id, staff_id, branch_id)
    VALUES (v_target_biz_id, v_t_pauh, v_pauh_branch_id);
  EXCEPTION WHEN unique_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'TEST 10a FAILED: Duplicate direct INSERT was not rejected';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_teacher_branch_assignments(v_target_biz_id, v_t_pauh, ARRAY[v_pauh_branch_id, v_pauh_branch_id]);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg ILIKE '%Duplicate branch assignment%' THEN
      v_rejected := TRUE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'TEST 10b FAILED: Duplicate RPC assignment was not rejected';
  END IF;

  -- Test 15: Cross-business assignment is rejected
  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_teacher_branch_assignments(v_target_biz_id, v_t_pauh, ARRAY[v_other_branch_id]);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg ILIKE '%Invalid, cross-business, or inactive branch_id%' THEN
      v_rejected := TRUE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'TEST 15 FAILED: Cross-business assignment was not rejected';
  END IF;

  -- ----------------------------------------------------------
  -- Switch to Pauh Jaya Staff
  -- ----------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pauh_staff_uid::text, 'role', 'authenticated')::text, true);

  -- Tests 5, 6, 8, 9 (Pauh Jaya view)
  SELECT COUNT(*) INTO v_count FROM public.get_staff_directory(v_target_biz_id) WHERE id = v_t_pauh;
  IF v_count <> 1 THEN RAISE EXCEPTION 'TEST 5a FAILED: Pauh Jaya Staff cannot see Pauh Jaya teacher'; END IF;

  SELECT COUNT(*) INTO v_count FROM public.get_staff_directory(v_target_biz_id) WHERE id = v_t_both;
  IF v_count <> 1 THEN RAISE EXCEPTION 'TEST 5b/8 FAILED: Pauh Jaya Staff cannot see multi-branch teacher'; END IF;

  SELECT COUNT(*) INTO v_count FROM public.get_staff_directory(v_target_biz_id) WHERE id = v_t_kelisa;
  IF v_count <> 0 THEN RAISE EXCEPTION 'TEST 6 FAILED: Pauh Jaya Staff can see Kelisa Emas-only teacher!'; END IF;

  SELECT COUNT(*) INTO v_count FROM public.get_staff_directory(v_target_biz_id) WHERE id = v_t_unassigned;
  IF v_count <> 0 THEN RAISE EXCEPTION 'TEST 9a FAILED: Pauh Jaya Staff can see unassigned teacher!'; END IF;

  -- Direct table RLS check for Pauh Jaya Staff
  SELECT COUNT(*) INTO v_count FROM public.staff WHERE id IN (v_t_kelisa, v_t_unassigned);
  IF v_count <> 0 THEN RAISE EXCEPTION 'TEST 6/9 RLS FAILED: Pauh Jaya Staff saw Kelisa or unassigned teacher via direct staff query'; END IF;

  -- Tests 11, 12, 13: Unauthorized Staff cannot create/update/delete assignments
  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.staff_branch_assignments (business_id, staff_id, branch_id)
    VALUES (v_target_biz_id, v_t_unassigned, v_pauh_branch_id);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'TEST 11a FAILED: Staff direct INSERT into staff_branch_assignments succeeded!'; END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_teacher_branch_assignments(v_target_biz_id, v_t_pauh, ARRAY[v_pauh_branch_id]);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg ILIKE '%Access denied%' THEN v_rejected := TRUE; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'TEST 11b FAILED: Staff RPC assignment succeeded!'; END IF;

  UPDATE public.staff_branch_assignments SET branch_id = v_kelisa_branch_id WHERE staff_id = v_t_pauh;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'TEST 12 FAILED: Staff updated % assignment rows!', v_count; END IF;

  DELETE FROM public.staff_branch_assignments WHERE staff_id = v_t_pauh;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'TEST 13 FAILED: Staff deleted % assignment rows!', v_count; END IF;

  -- Test 17: Salary privacy still enforced for Pauh Jaya Staff
  v_rejected := FALSE;
  BEGIN
    PERFORM * FROM public.get_teachers_with_salary(v_target_biz_id);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg ILIKE '%Access denied%' THEN v_rejected := TRUE; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'TEST 17 FAILED: Pauh Jaya Staff accessed get_teachers_with_salary!'; END IF;

  -- ----------------------------------------------------------
  -- Switch to Kelisa Emas Staff
  -- ----------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_kelisa_staff_uid::text, 'role', 'authenticated')::text, true);

  -- Tests 5, 7, 8, 9 (Kelisa Emas view)
  SELECT COUNT(*) INTO v_count FROM public.get_staff_directory(v_target_biz_id) WHERE id = v_t_kelisa;
  IF v_count <> 1 THEN RAISE EXCEPTION 'TEST 5c FAILED: Kelisa Emas Staff cannot see Kelisa Emas teacher'; END IF;

  SELECT COUNT(*) INTO v_count FROM public.get_staff_directory(v_target_biz_id) WHERE id = v_t_both;
  IF v_count <> 1 THEN RAISE EXCEPTION 'TEST 5d/8 FAILED: Kelisa Emas Staff cannot see multi-branch teacher'; END IF;

  SELECT COUNT(*) INTO v_count FROM public.get_staff_directory(v_target_biz_id) WHERE id = v_t_pauh;
  IF v_count <> 0 THEN RAISE EXCEPTION 'TEST 7 FAILED: Kelisa Emas Staff can see Pauh Jaya-only teacher!'; END IF;

  SELECT COUNT(*) INTO v_count FROM public.get_staff_directory(v_target_biz_id) WHERE id = v_t_unassigned;
  IF v_count <> 0 THEN RAISE EXCEPTION 'TEST 9b FAILED: Kelisa Emas Staff can see unassigned teacher!'; END IF;

  -- ----------------------------------------------------------
  -- Test 14: Generic Admin cannot inherit Puan Hana's exact UID permission
  -- ----------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_generic_admin_uid::text, 'role', 'authenticated')::text, true);

  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_teacher_branch_assignments(v_target_biz_id, v_t_pauh, ARRAY[v_pauh_branch_id]);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg ILIKE '%Access denied%' THEN v_rejected := TRUE; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'TEST 14a FAILED: Generic Admin inherited assignment RPC permission!'; END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.staff_branch_assignments (business_id, staff_id, branch_id)
    VALUES (v_target_biz_id, v_t_unassigned, v_pauh_branch_id);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'TEST 14b FAILED: Generic Admin inserted into staff_branch_assignments!'; END IF;

  -- Test 18: Financial summary RPC still executes cleanly
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hana_uid::text, 'role', 'authenticated')::text, true);
  SELECT COUNT(*) INTO v_count FROM public.get_financial_summary(v_target_biz_id, '2026-11-01'::date, '2026-11-30'::date, 'November', 2026, NULL);
  IF v_count <> 1 THEN RAISE EXCEPTION 'TEST 18 FAILED: get_financial_summary did not return 1 row'; END IF;

  -- Test 16: Protected Workspace untouched
  RESET ROLE;
  SELECT
    (SELECT COUNT(*) FROM public.branches WHERE business_id = v_protected_biz_id) +
    (SELECT COUNT(*) FROM public.staff_branch_assignments WHERE business_id = v_protected_biz_id) +
    (SELECT COUNT(*) FROM public.staff WHERE business_id = v_protected_biz_id)
  INTO v_protected_after;
  IF v_protected_after <> v_protected_before THEN
    RAISE EXCEPTION 'TEST 16 FAILED: Protected workspace count changed (% -> %)', v_protected_before, v_protected_after;
  END IF;

  RAISE NOTICE 'ALL 18 MIGRATION 09 MULTI-BRANCH TEACHER ASSIGNMENT TESTS PASSED!';
END $$;

ROLLBACK;
