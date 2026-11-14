-- ============================================================
-- BIZTRACK MIGRATION 08 ROLLBACK: SALARY PRIVACY, HISTORICAL BRANCH PAYROLL & ACCESS CONTROL
-- ============================================================
-- Safely reverts Migration 08 changes within a single atomic transaction while
-- preserving RLS enabled on all tables and protecting historical financial data.
--
-- Column Provenance & Rollback Modes:
--   Migration 08 records every column it newly creates (versus pre-existing
--   columns) in public._migration_08_added_columns:
--     - On baselines where 02/03 soft-delete columns and 07 staff.branch_id
--       already existed, ONLY newly added columns (e.g. staff_payments.branch_id,
--       expenses.branch_id) are marked as Migration 08-created.
--     - On a Production baseline lacking 02/03 soft-delete columns, Migration 08
--       also marks the newly added deleted_at / deleted_by columns on staff,
--       groups, staff_payments, and expenses as Migration 08-created.
--
--   1. DEFAULT (Data-Preserving Rollback — biztrack.drop_migration_08_columns unset/'false'):
--      Reverts triggers, RPCs, RLS policies, and column/table grants.
--      PRESERVES branch_id, deleted_at, deleted_by, composite/deleted_by FKs,
--      and indexes so historical branch attribution, soft-delete audit trails,
--      and financial data are never destroyed.
--      NOTE: Because Migration 08-introduced columns remain in the schema under
--      this default mode, exact pre-migration column-list parity does NOT apply
--      (RLS policy, grant, function, and trigger parity applies instead).
--
--   2. OPT-IN STRUCTURAL ROLLBACK (SET LOCAL biztrack.drop_migration_08_columns = 'true';):
--      Deliberate opt-in mode that removes ONLY columns recorded in
--      public._migration_08_added_columns (never drops any column that existed
--      before Migration 08) and their Migration 08-created FKs/indexes.
--      Fails closed if any Migration 08-created deleted_at or deleted_by column
--      contains non-null values (only removes soft-delete columns when safe).
--   NOTE ON SALARY PRIVACY: Rolling back Migration 08 restores the pre-Migration 08
--   "Users can access data in their business" policies and table-level SELECT/DML
--   grants on public.staff, public.staff_payments, and public.expenses, which
--   re-opens broad business-member access to salary columns and staff_payments.
--   Do NOT run rollback in Production unless intentionally reverting Task 3.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. DROP MIGRATION 08 TRIGGERS & TRIGGER FUNCTIONS
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_enforce_staff_branch ON public.staff;
DROP TRIGGER IF EXISTS trg_enforce_staff_payment_branch ON public.staff_payments;
DROP TRIGGER IF EXISTS trg_enforce_expense_branch ON public.expenses;
DROP TRIGGER IF EXISTS trg_enforce_expense_salary_reconciliation ON public.expenses;
DROP TRIGGER IF EXISTS trg_protect_linked_staff_payment_delete ON public.staff_payments;
DROP TRIGGER IF EXISTS trg_handle_linked_staff_payment_soft_delete ON public.staff_payments;

DROP FUNCTION IF EXISTS public.enforce_staff_branch();
DROP FUNCTION IF EXISTS public.enforce_staff_payment_branch();
DROP FUNCTION IF EXISTS public.enforce_expense_branch();
DROP FUNCTION IF EXISTS public.enforce_expense_salary_reconciliation();
DROP FUNCTION IF EXISTS public.protect_linked_staff_payment_delete();
DROP FUNCTION IF EXISTS public.handle_linked_staff_payment_soft_delete();

-- ------------------------------------------------------------
-- 2. DROP MIGRATION 08 RPC FUNCTIONS (ALL SIGNATURES)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reconcile_salary_expense(UUID, UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.get_reconcilable_staff_payments(UUID, UUID);
DROP FUNCTION IF EXISTS public.get_unresolved_salary_expenses(UUID, UUID);
DROP FUNCTION IF EXISTS public.assign_staff_payment_branch(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.get_historical_payroll_audit(UUID);
DROP FUNCTION IF EXISTS public.get_payroll_reconciliation_summary(UUID, TEXT, INT);
DROP FUNCTION IF EXISTS public.get_monthly_financial_summary(UUID, INT, UUID);
DROP FUNCTION IF EXISTS public.get_financial_summary(UUID, DATE, DATE, TEXT, INT, UUID);
DROP FUNCTION IF EXISTS public.get_monthly_expenses_summary(UUID, INT, UUID);
DROP FUNCTION IF EXISTS public.get_expenses_summary(UUID, DATE, DATE, UUID);
DROP FUNCTION IF EXISTS public.get_staff_expenses_summary(UUID, TEXT, INT);
DROP FUNCTION IF EXISTS public.get_staff_expenses_summary(UUID, TEXT, INT, UUID);
DROP FUNCTION IF EXISTS public.resolve_authorized_expense_branch(UUID, UUID);
DROP FUNCTION IF EXISTS public.delete_teacher(UUID, UUID);
DROP FUNCTION IF EXISTS public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID);
DROP FUNCTION IF EXISTS public.save_teacher_with_salary(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.get_staff_directory(UUID);
DROP FUNCTION IF EXISTS public.get_teachers_with_salary(UUID);

-- ------------------------------------------------------------
-- 3. RESTORE PRE-MIGRATION 08 RLS POLICIES ON public.staff,
--    public.staff_payments, AND public.expenses
-- ------------------------------------------------------------
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- 3a. public.staff policies
DROP POLICY IF EXISTS "Business members can access staff directory" ON public.staff;
DROP POLICY IF EXISTS "Business members can view staff directory" ON public.staff;
DROP POLICY IF EXISTS "Authorized salary manager can insert staff" ON public.staff;
DROP POLICY IF EXISTS "Authorized salary manager can update staff" ON public.staff;
DROP POLICY IF EXISTS "Authorized salary manager can delete staff" ON public.staff;
DROP POLICY IF EXISTS "Users can access data in their business" ON public.staff;

CREATE POLICY "Users can access data in their business"
  ON public.staff
  FOR ALL
  USING (business_id IN (SELECT public.user_businesses()));

-- 3b. public.staff_payments policies
DROP POLICY IF EXISTS "Authorized salary manager can access staff payments" ON public.staff_payments;
DROP POLICY IF EXISTS "Users can access data in their business" ON public.staff_payments;

CREATE POLICY "Users can access data in their business"
  ON public.staff_payments
  FOR ALL
  USING (business_id IN (SELECT public.user_businesses()));

-- 3c. public.expenses policies
DROP POLICY IF EXISTS "Business members can view expenses" ON public.expenses;
DROP POLICY IF EXISTS "Business write users can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Business write users can update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Business write users can delete expenses" ON public.expenses;
DROP POLICY IF EXISTS "Users can access data in their business" ON public.expenses;

CREATE POLICY "Users can access data in their business"
  ON public.expenses
  FOR ALL
  USING (business_id IN (SELECT public.user_businesses()));

-- ------------------------------------------------------------
-- 4. DROP PINNED AUTHORIZATION & CLASSIFICATION HELPERS
--    (AFTER DEPENDENT POLICIES ARE DROPPED)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_salary_authorized(UUID);
DROP FUNCTION IF EXISTS public.is_salary_expense_category(TEXT);

-- ------------------------------------------------------------
-- 5. CLEANLY REVOKE COLUMN-LEVEL GRANTS & RESTORE TABLE-LEVEL GRANTS
-- ------------------------------------------------------------
-- Explicitly clear column-level ACLs (pg_attribute.attacl) on public.staff
REVOKE ALL (
  id,
  business_id,
  branch_id,
  name,
  role,
  phone,
  notes,
  created_at,
  deleted_at,
  deleted_by
) ON public.staff FROM PUBLIC, anon, authenticated;

-- Ensure PUBLIC and anon hold zero table-level privileges, and reset authenticated table ACLs cleanly
REVOKE ALL ON public.staff FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.staff_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.expenses FROM PUBLIC, anon, authenticated;

-- Restore pre-Migration 08 DML table-level privileges for authenticated (without granting TRUNCATE/TRIGGER/REFERENCES)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;

-- ------------------------------------------------------------
-- 6. OPTIONAL STRUCTURAL COLUMN DROP (DEFAULT: PRESERVE HISTORICAL DATA)
--    - Only drops columns recorded in public._migration_08_added_columns.
--    - Never drops columns that existed prior to Migration 08.
--    - Fails closed if any Migration 08-added soft-delete column contains data.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_has_provenance BOOLEAN;
  v_row RECORD;
  v_non_null_count BIGINT;
BEGIN
  IF COALESCE(current_setting('biztrack.drop_migration_08_columns', true), 'false') = 'true' THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_migration_08_added_columns'
    ) INTO v_has_provenance;

    IF NOT v_has_provenance THEN
      RAISE EXCEPTION 'Structural rollback aborted: public._migration_08_added_columns is missing, so pre-existing vs Migration 08-created columns cannot be distinguished safely.';
    END IF;

    -- Safety check: refuse to drop Migration 08-created deleted_at/deleted_by if populated
    FOR v_row IN
      SELECT table_name, column_name
      FROM public._migration_08_added_columns
      WHERE column_name IN ('deleted_at', 'deleted_by')
      ORDER BY table_name, column_name
    LOOP
      EXECUTE format(
        'SELECT COUNT(*) FROM public.%I WHERE %I IS NOT NULL',
        v_row.table_name,
        v_row.column_name
      ) INTO v_non_null_count;

      IF v_non_null_count > 0 THEN
        RAISE EXCEPTION 'Structural rollback aborted: public.%.% contains % non-null soft-delete record(s).',
          v_row.table_name, v_row.column_name, v_non_null_count;
      END IF;
    END LOOP;

    -- Drop Migration 08-created FKs, indexes, and columns only
    FOR v_row IN
      SELECT table_name, column_name
      FROM public._migration_08_added_columns
      ORDER BY table_name, column_name
    LOOP
      IF v_row.column_name = 'branch_id' THEN
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', v_row.table_name, v_row.table_name || '_branch_business_fkey');
        EXECUTE format('DROP INDEX IF EXISTS public.%I', 'idx_' || v_row.table_name || '_business_branch');
      ELSIF v_row.column_name = 'deleted_by' THEN
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', v_row.table_name, v_row.table_name || '_deleted_by_fkey');
      ELSIF v_row.column_name = 'staff_payment_id' THEN
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', v_row.table_name, v_row.table_name || '_staff_payment_id_fkey');
        EXECUTE 'DROP INDEX IF EXISTS public.idx_expenses_staff_payment_id';
        EXECUTE 'DROP INDEX IF EXISTS public.uidx_expenses_staff_payment_id';
      ELSIF v_row.column_name = 'salary_reconciliation_status' THEN
        EXECUTE 'ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_salary_reconciliation_status_check';
        EXECUTE 'ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_linked_duplicate_requires_payment_check';
      END IF;

      EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS %I', v_row.table_name, v_row.column_name);
    END LOOP;

    DROP TABLE IF EXISTS public._migration_08_added_columns;

    RAISE NOTICE 'Migration 08 structural rollback: Dropped Migration 08-created columns, FKs, and indexes (pre-existing columns preserved).';
  ELSE
    RAISE NOTICE 'Migration 08 data-preserving rollback: Preserved branch_id and soft-delete columns/data on staff, groups, staff_payments, and expenses (newly introduced columns remain in catalog).';
  END IF;
END $$;

COMMIT;
