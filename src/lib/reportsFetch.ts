import {
  buildDashboardContextKey,
  formatSafeDashboardError,
  PayrollReconciliationSummary,
} from './dashboardFetch';

export interface ReportsSummaryPayload {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  standaloneSalaryExpenses: number;
  unresolvedSalaryExpenseCount: number;
  unresolvedSalaryExpenseAmount: number;
  isReconciled: boolean;
}

export interface ReportsChartPoint {
  name: string;
  Income: number;
  Expenses: number;
}

export const EMPTY_REPORTS_SUMMARY: ReportsSummaryPayload = {
  totalIncome: 0,
  totalExpenses: 0,
  netProfit: 0,
  standaloneSalaryExpenses: 0,
  unresolvedSalaryExpenseCount: 0,
  unresolvedSalaryExpenseAmount: 0,
  isReconciled: true,
};

export interface ReportsFetchResult<TRecon = PayrollReconciliationSummary> {
  summary: ReportsSummaryPayload;
  chartData: ReportsChartPoint[];
  payrollReconciliation: TRecon | null;
}

export interface ReportsStateCallbacks<TRecon = PayrollReconciliationSummary> {
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSummary: (summary: ReportsSummaryPayload) => void;
  setChartData: (chartData: ReportsChartPoint[]) => void;
  setPayrollReconciliation: (recon: TRecon | null) => void;
  setLoadedContextKey?: (contextKey: string | null) => void;
}

function resetReportsState<TRecon>(
  callbacks: ReportsStateCallbacks<TRecon>,
  errorMessage: string | null
): void {
  callbacks.setLoadedContextKey?.(null);
  callbacks.setPayrollReconciliation(null);
  callbacks.setSummary(EMPTY_REPORTS_SUMMARY);
  callbacks.setChartData([]);
  callbacks.setError(errorMessage);
}

/**
 * Executes an atomic, sequence-guarded Reports fetch so:
 * 1. Stale async responses/errors never overwrite newer branch/filter/business state or clear loading.
 * 2. Missing business context or branch/filter changes clear previous financial data immediately.
 * 3. Failed payment queries or financial/payroll RPCs never silently become RM0; they reset state and surface an error.
 */
export async function executeReportsFetch<TRecon = PayrollReconciliationSummary>(params: {
  seqRef: { current: number };
  userId: string | null | undefined;
  businessId: string | null | undefined;
  selectedBranchId?: string | null | undefined;
  isSalaryAuthorized: boolean;
  callbacks: ReportsStateCallbacks<TRecon>;
  loadReport: () => Promise<ReportsFetchResult<TRecon>>;
}): Promise<void> {
  const requestId = ++params.seqRef.current;
  const { seqRef, userId, businessId, selectedBranchId, isSalaryAuthorized, callbacks, loadReport } = params;
  const isLatest = () => requestId === seqRef.current;
  const contextKey = buildDashboardContextKey(userId, businessId, selectedBranchId, isSalaryAuthorized);

  if (!userId || !businessId || !contextKey) {
    resetReportsState(callbacks, null);
    callbacks.setLoading(false);
    return;
  }

  resetReportsState(callbacks, null);
  callbacks.setLoading(true);

  try {
    const result = await loadReport();
    if (!isLatest()) return;

    callbacks.setError(null);
    callbacks.setPayrollReconciliation(isSalaryAuthorized ? result.payrollReconciliation : null);
    callbacks.setSummary(result.summary);
    callbacks.setChartData(result.chartData);
    callbacks.setLoadedContextKey?.(contextKey);
  } catch (err) {
    console.error('Error fetching reports data:', err);
    if (isLatest()) {
      resetReportsState(callbacks, formatSafeDashboardError(err));
    }
  } finally {
    if (isLatest()) {
      callbacks.setLoading(false);
    }
  }
}
