export interface DashboardStatsPayload {
  monthlyCollection: number;
  monthlyExpenses: number;
  netProfit: number;
  outstandingPayment: number;
  totalStudents: number;
  totalClasses: number;
  totalTeachers: number;
  standaloneSalaryExpenses: number;
  unresolvedSalaryExpenseCount: number;
  unresolvedSalaryExpenseAmount: number;
  isReconciled: boolean;
}

export interface PayrollReconciliationSummary {
  consolidated_payroll: number;
  pauh_jaya_payroll: number;
  kelisa_emas_payroll: number;
  branch_allocated_payroll: number;
  unmapped_payroll: number;
  total_payment_count: number;
  confidently_mapped_count: number;
  unmapped_payment_count: number;
  ambiguous_ownership_count: number;
  unestablished_branch_count: number;
  is_reconciled: boolean;
}

export interface DashboardPrimaryResult<TPayment = any, TExpense = any, TRecon = PayrollReconciliationSummary> {
  stats: DashboardStatsPayload;
  recentPayments: TPayment[];
  recentExpenses: TExpense[];
  payrollReconciliation: TRecon | null;
}

export interface DashboardStateCallbacks<TPayment = any, TExpense = any, TTrend = any, TRecon = PayrollReconciliationSummary> {
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLoadedContextKey?: (contextKey: string | null) => void;
  setStats: (stats: DashboardStatsPayload) => void;
  setRecentPayments: (payments: TPayment[]) => void;
  setRecentExpenses: (expenses: TExpense[]) => void;
  setTrendData: (trend: TTrend[]) => void;
  setPayrollReconciliation: (recon: TRecon | null) => void;
}

export const EMPTY_DASHBOARD_STATS: DashboardStatsPayload = {
  monthlyCollection: 0,
  monthlyExpenses: 0,
  netProfit: 0,
  outstandingPayment: 0,
  totalStudents: 0,
  totalClasses: 0,
  totalTeachers: 0,
  standaloneSalaryExpenses: 0,
  unresolvedSalaryExpenseCount: 0,
  unresolvedSalaryExpenseAmount: 0,
  isReconciled: true,
};

export function buildDashboardContextKey(
  userId: string | null | undefined,
  businessId: string | null | undefined,
  selectedBranchId: string | null | undefined,
  isSalaryAuthorized: boolean
): string | null {
  if (!userId || !businessId) return null;
  return `${userId}::${businessId}::${selectedBranchId || 'all'}::${isSalaryAuthorized ? 'auth' : 'restricted'}`;
}

/**
 * Strictly parses a finite number or PostgreSQL decimal numeric string.
 * Rejects null, undefined, booleans, empty/whitespace strings, NaN, Infinity, -Infinity,
 * and non-decimal strings without silently coercing invalid values to zero.
 */
export function parseStrictFiniteNumber(value: unknown, fieldLabel: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid numeric value for ${fieldLabel}: non-finite number.`);
    }
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || !/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) {
      throw new Error(`Invalid numeric string for ${fieldLabel}.`);
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid numeric string for ${fieldLabel}: non-finite.`);
    }
    return parsed;
  }

  throw new Error(`Invalid value type for ${fieldLabel}: expected finite number or numeric string.`);
}

/**
 * Strictly validates a boolean field without truthy/falsy coercion.
 */
export function parseStrictBoolean(value: unknown, fieldLabel: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid boolean value for ${fieldLabel}: expected actual boolean.`);
  }
  return value;
}

/**
 * Strictly parses a finite, non-negative integer (or non-negative integer string).
 * Rejects negative numbers, fractions, null, undefined, empty/whitespace strings,
 * booleans, NaN, Infinity, -Infinity, and malformed numeric strings.
 */
export function parseStrictNonNegativeInteger(value: unknown, fieldLabel: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid non-negative integer for ${fieldLabel}.`);
    }
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || !/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid non-negative integer string for ${fieldLabel}.`);
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error(`Invalid non-negative integer string for ${fieldLabel}.`);
    }
    return parsed;
  }

  throw new Error(`Invalid value type for ${fieldLabel}: expected non-negative integer.`);
}

/**
 * Validates a standard Supabase PostgREST query response so database/RLS errors
 * are thrown rather than silently coerced into empty arrays or zero counts.
 */
export function unwrapSupabaseQuery<T>(
  result: { data: T | null; error: { message?: string } | null; count?: number | null },
  contextLabel: string
): { data: T | null; count: number | null } {
  if (result.error) {
    throw new Error(`Dashboard query failed (${contextLabel}): ${result.error.message || 'Unknown database error'}`);
  }
  return {
    data: result.data,
    count: result.count ?? null,
  };
}

/**
 * Validates the scalar payroll aggregate RPC response.
 * Accepts finite numbers and valid non-empty numeric strings from PostgreSQL;
 * rejects null, undefined, empty/whitespace strings, booleans, NaN, Infinity, -Infinity.
 */
export function unwrapStaffPayrollRpc(
  result: { data: unknown; error: { message?: string } | null }
): number {
  if (result.error) {
    const msg = result.error.message || 'Failed to load payroll summary.';
    const isUnauthorized = /access denied|not authorized|permission denied|insufficient_privilege/i.test(msg);
    throw new Error(
      isUnauthorized
        ? 'Access denied while loading branch payroll summary.'
        : `Failed to load branch payroll summary: ${msg}`
    );
  }
  return parseStrictFiniteNumber(result.data, 'branch payroll summary');
}

/**
 * Strictly maps and validates a payroll reconciliation RPC row.
 */
export function mapPayrollReconciliationRow(row: Record<string, unknown>): PayrollReconciliationSummary {
  if (!row || typeof row !== 'object') {
    throw new Error('Malformed payroll reconciliation row.');
  }
  return {
    consolidated_payroll: parseStrictFiniteNumber(row.consolidated_payroll, 'consolidated_payroll'),
    pauh_jaya_payroll: parseStrictFiniteNumber(row.pauh_jaya_payroll, 'pauh_jaya_payroll'),
    kelisa_emas_payroll: parseStrictFiniteNumber(row.kelisa_emas_payroll, 'kelisa_emas_payroll'),
    branch_allocated_payroll: parseStrictFiniteNumber(row.branch_allocated_payroll, 'branch_allocated_payroll'),
    unmapped_payroll: parseStrictFiniteNumber(row.unmapped_payroll, 'unmapped_payroll'),
    total_payment_count: parseStrictNonNegativeInteger(row.total_payment_count, 'total_payment_count'),
    confidently_mapped_count: parseStrictNonNegativeInteger(row.confidently_mapped_count, 'confidently_mapped_count'),
    unmapped_payment_count: parseStrictNonNegativeInteger(row.unmapped_payment_count, 'unmapped_payment_count'),
    ambiguous_ownership_count: parseStrictNonNegativeInteger(row.ambiguous_ownership_count, 'ambiguous_ownership_count'),
    unestablished_branch_count: parseStrictNonNegativeInteger(row.unestablished_branch_count, 'unestablished_branch_count'),
    is_reconciled: parseStrictBoolean(row.is_reconciled, 'is_reconciled'),
  };
}

/**
 * Validates the payroll reconciliation RPC response for authorized salary admins.
 */
export function unwrapPayrollReconciliationRpc<TRecon = PayrollReconciliationSummary>(
  result: { data: unknown; error: { message?: string } | null },
  isSalaryAuthorized: boolean,
  mapRow: (row: Record<string, unknown>) => TRecon = mapPayrollReconciliationRow as unknown as (row: Record<string, unknown>) => TRecon
): TRecon | null {
  if (!isSalaryAuthorized) {
    return null;
  }
  if (result.error) {
    const msg = result.error.message || 'Failed to load payroll reconciliation summary.';
    const isUnauthorized = /access denied|not authorized|permission denied|insufficient_privilege/i.test(msg);
    throw new Error(
      isUnauthorized
        ? 'Access denied while loading payroll reconciliation summary.'
        : `Failed to load payroll reconciliation summary: ${msg}`
    );
  }
  if (!Array.isArray(result.data) || result.data.length === 0) {
    throw new Error('Payroll reconciliation summary returned no rows.');
  }
  return mapRow(result.data[0] as Record<string, unknown>);
}

export function formatSafeDashboardError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (/access denied/i.test(msg)) {
    return 'Access denied while loading branch financial data. Please verify your branch permissions.';
  }
  return 'Unable to load dashboard financial data. Please retry or contact your administrator.';
}

function resetDashboardState<TPayment, TExpense, TTrend, TRecon>(
  callbacks: DashboardStateCallbacks<TPayment, TExpense, TTrend, TRecon>,
  errorMessage: string | null
): void {
  callbacks.setLoadedContextKey?.(null);
  callbacks.setPayrollReconciliation(null);
  callbacks.setStats(EMPTY_DASHBOARD_STATS);
  callbacks.setRecentPayments([]);
  callbacks.setRecentExpenses([]);
  callbacks.setTrendData([]);
  callbacks.setError(errorMessage);
}

/**
 * Executes an atomic, sequence-guarded Dashboard fetch so:
 * 1. Stale async responses/errors never overwrite newer branch/business state or clear loading.
 * 2. Branch/business switches clear previous-branch data immediately and bind published state to contextKey.
 * 3. Latest-request failures in either primary or trend queries reset all financial state safely.
 */
export async function executeDashboardFetch<TPayment, TExpense, TTrend, TRecon = PayrollReconciliationSummary>(params: {
  seqRef: { current: number };
  userId: string | null | undefined;
  businessId: string | null | undefined;
  selectedBranchId?: string | null | undefined;
  isSalaryAuthorized: boolean;
  callbacks: DashboardStateCallbacks<TPayment, TExpense, TTrend, TRecon>;
  loadPrimary: () => Promise<DashboardPrimaryResult<TPayment, TExpense, TRecon>>;
  loadTrend: () => Promise<TTrend[]>;
}): Promise<void> {
  const { seqRef, userId, businessId, selectedBranchId, isSalaryAuthorized, callbacks, loadPrimary, loadTrend } = params;
  const requestId = ++seqRef.current;
  const isLatest = () => requestId === seqRef.current;
  const contextKey = buildDashboardContextKey(userId, businessId, selectedBranchId, isSalaryAuthorized);

  if (!userId || !businessId || !contextKey) {
    resetDashboardState(callbacks, null);
    callbacks.setLoading(false);
    return;
  }

  // Immediately clear previously loaded branch/business state so stale branch data cannot be displayed
  resetDashboardState(callbacks, null);
  callbacks.setLoading(true);

  try {
    const [primary, trend] = await Promise.all([loadPrimary(), loadTrend()]);
    if (!isLatest()) return;

    callbacks.setError(null);
    callbacks.setPayrollReconciliation(isSalaryAuthorized ? primary.payrollReconciliation : null);
    callbacks.setStats(primary.stats);
    callbacks.setRecentPayments(primary.recentPayments);
    callbacks.setRecentExpenses(primary.recentExpenses);
    callbacks.setTrendData(trend);
    callbacks.setLoadedContextKey?.(contextKey);
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    if (isLatest()) {
      resetDashboardState(callbacks, formatSafeDashboardError(err));
    }
  } finally {
    if (isLatest()) {
      callbacks.setLoading(false);
    }
  }
}

const SALARY_EXPENSE_CATEGORY_PATTERN = /\b(salar(y|ies)|payroll|wages?)\b/i;

/**
 * Matches salary-related expense categories (aligned with SQL public.is_salary_expense_category).
 */
export function isSalaryExpenseCategory(category?: string | null): boolean {
  if (typeof category !== 'string') return false;
  return SALARY_EXPENSE_CATEGORY_PATTERN.test(category.trim());
}

/**
 * Defense-in-depth client filter ensuring unauthorized users never render individual
 * salary-category expense records, descriptions, notes, or amounts.
 */
export function filterVisibleExpenses<T extends { category?: string | null }>(
  expenses: readonly T[],
  isSalaryAuthorized: boolean
): T[] {
  if (isSalaryAuthorized) return [...expenses];
  return expenses.filter((expense) => !isSalaryExpenseCategory(expense.category));
}

export interface FinancialSummaryPayload {
  collections: number;
  non_salary_expenses: number;
  teacher_payroll: number;
  standalone_salary_expenses: number;
  unresolved_salary_expense_count: number;
  unresolved_salary_expense_amount: number;
  total_expenses: number;
  net_profit: number;
  is_reconciled: boolean;
}

export interface MonthlyFinancialRow {
  month_num: number;
  month_name: string;
  non_salary_expenses: number;
  teacher_payroll: number;
  standalone_salary_expenses: number;
  unresolved_salary_expense_count: number;
  unresolved_salary_expense_amount: number;
  total_expenses: number;
  is_reconciled: boolean;
}

/**
 * Validates the centralized get_financial_summary RPC response.
 * Rejects RPC errors, empty/non-array payloads, and non-finite/malformed numeric fields.
 */
export function unwrapFinancialSummaryRpc(
  result: { data: unknown; error: { message?: string } | null }
): FinancialSummaryPayload {
  if (result.error) {
    const msg = result.error.message || 'Failed to load financial summary.';
    const isUnauthorized = /access denied|not authorized|permission denied|insufficient_privilege/i.test(msg);
    throw new Error(
      isUnauthorized
        ? 'Access denied while loading branch financial summary.'
        : `Failed to load branch financial summary: ${msg}`
    );
  }

  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row || typeof row !== 'object') {
    throw new Error('Invalid financial summary response: expected row object.');
  }

  const r = row as Record<string, unknown>;
  const collections = parseStrictFiniteNumber(r.collections, 'collections');
  const non_salary_expenses = parseStrictFiniteNumber(r.non_salary_expenses, 'non_salary_expenses');
  const teacher_payroll = parseStrictFiniteNumber(r.teacher_payroll, 'teacher_payroll');
  const standalone_salary_expenses = parseStrictFiniteNumber(
    r.standalone_salary_expenses,
    'standalone_salary_expenses'
  );
  const unresolved_salary_expense_count = parseStrictNonNegativeInteger(
    r.unresolved_salary_expense_count,
    'unresolved_salary_expense_count'
  );
  const unresolved_salary_expense_amount = parseStrictFiniteNumber(
    r.unresolved_salary_expense_amount,
    'unresolved_salary_expense_amount'
  );
  const total_expenses = parseStrictFiniteNumber(r.total_expenses, 'total_expenses');
  const net_profit = parseStrictFiniteNumber(r.net_profit, 'net_profit');
  const is_reconciled = parseStrictBoolean(r.is_reconciled, 'is_reconciled');

  return {
    collections,
    non_salary_expenses,
    teacher_payroll,
    standalone_salary_expenses,
    unresolved_salary_expense_count,
    unresolved_salary_expense_amount,
    total_expenses,
    net_profit,
    is_reconciled,
  };
}

/**
 * Validates the centralized get_monthly_financial_summary RPC response.
 */
export function unwrapMonthlyFinancialSummaryRpc(
  result: { data: unknown; error: { message?: string } | null }
): MonthlyFinancialRow[] {
  if (result.error) {
    const msg = result.error.message || 'Failed to load monthly financial summary.';
    const isUnauthorized = /access denied|not authorized|permission denied|insufficient_privilege/i.test(msg);
    throw new Error(
      isUnauthorized
        ? 'Access denied while loading monthly financial summary.'
        : `Failed to load monthly financial summary: ${msg}`
    );
  }

  if (!Array.isArray(result.data)) {
    throw new Error('Invalid monthly financial summary response: expected array.');
  }

  return result.data.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid monthly financial summary row at index ${idx}.`);
    }
    const r = item as Record<string, unknown>;
    const month_num = parseStrictNonNegativeInteger(r.month_num, `month_num[${idx}]`);
    if (typeof r.month_name !== 'string' || r.month_name.trim() === '') {
      throw new Error(`Invalid month_name at index ${idx}.`);
    }
    return {
      month_num,
      month_name: r.month_name,
      non_salary_expenses: parseStrictFiniteNumber(r.non_salary_expenses, `non_salary_expenses[${idx}]`),
      teacher_payroll: parseStrictFiniteNumber(r.teacher_payroll, `teacher_payroll[${idx}]`),
      standalone_salary_expenses: parseStrictFiniteNumber(
        r.standalone_salary_expenses,
        `standalone_salary_expenses[${idx}]`
      ),
      unresolved_salary_expense_count: parseStrictNonNegativeInteger(
        r.unresolved_salary_expense_count,
        `unresolved_salary_expense_count[${idx}]`
      ),
      unresolved_salary_expense_amount: parseStrictFiniteNumber(
        r.unresolved_salary_expense_amount,
        `unresolved_salary_expense_amount[${idx}]`
      ),
      total_expenses: parseStrictFiniteNumber(r.total_expenses, `total_expenses[${idx}]`),
      is_reconciled: parseStrictBoolean(r.is_reconciled, `is_reconciled[${idx}]`),
    };
  });
}
