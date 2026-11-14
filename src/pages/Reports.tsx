import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { TrendingUp, TrendingDown, DollarSign, Printer, AlertCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ReportFilters, type FilterConfig } from '../components/ui/ReportFilters';
import { formatCurrency } from '../lib/currency';
import {
  buildDashboardContextKey,
  mapPayrollReconciliationRow,
  PayrollReconciliationSummary,
  unwrapMonthlyFinancialSummaryRpc,
  unwrapPayrollReconciliationRpc,
  unwrapSupabaseQuery,
} from '../lib/dashboardFetch';
import {
  EMPTY_REPORTS_SUMMARY,
  executeReportsFetch,
  ReportsChartPoint,
  ReportsSummaryPayload,
} from '../lib/reportsFetch';

export const Reports: React.FC = () => {
  const { t } = useTemplate();
  const { user, businessId, isSalaryAuthorized } = useAuth();
  const userId = user?.id ?? null;
  const { selectedBranchId, isMultiBranch } = useBranch();
  const fetchSeqRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReportsSummaryPayload>(EMPTY_REPORTS_SUMMARY);
  const [payrollReconciliation, setPayrollReconciliation] = useState<PayrollReconciliationSummary | null>(null);
  const [chartData, setChartData] = useState<ReportsChartPoint[]>([]);
  const currentYear = new Date().getFullYear().toString();
  
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({
    year: currentYear
  });

  const [classes, setClasses] = useState<{id: string, name: string}[]>([]);
  const [teachers, setTeachers] = useState<{id: string, name: string}[]>([]);

  useEffect(() => {
    if (!userId || !businessId) {
      setClasses([]);
      setTeachers([]);
      return;
    }
    let cancelled = false;
    const fetchSelectOptions = async () => {
      let grpQuery = supabase.from('groups').select('id, name').eq('business_id', businessId);
      if (selectedBranchId) {
        grpQuery = grpQuery.eq('branch_id', selectedBranchId);
      }
      const [grpRes, dirRes] = await Promise.all([
        grpQuery,
        supabase.rpc('get_staff_directory', { p_business_id: businessId }),
      ]);
      if (cancelled) return;
      if (grpRes.data) setClasses(grpRes.data);
      if (Array.isArray(dirRes.data)) {
        const rows = dirRes.data as { id: string; name: string; branch_id?: string | null }[];
        setTeachers(
          selectedBranchId
            ? rows.filter((r) => !r.branch_id || r.branch_id === selectedBranchId).map((r) => ({ id: r.id, name: r.name }))
            : rows.map((r) => ({ id: r.id, name: r.name }))
        );
      }
    };
    fetchSelectOptions();
    return () => { cancelled = true; };
  }, [userId, businessId, selectedBranchId]);

  const fetchReportData = useCallback(async () => {
    await executeReportsFetch<PayrollReconciliationSummary>({
      seqRef: fetchSeqRef,
      userId,
      businessId,
      selectedBranchId,
      isSalaryAuthorized,
      callbacks: {
        setLoading,
        setError,
        setSummary,
        setChartData,
        setPayrollReconciliation,
        setLoadedContextKey,
      },
      loadReport: async () => {
        const yearToFetch = activeFilters.year || currentYear;
        const numericYear = Number(yearToFetch);
        const shouldIncludeExpenses = !activeFilters.class_id && !activeFilters.teacher_id && !Number.isNaN(numericYear);

        let payQuery = supabase
          .from('payments')
          .select('amount, month, status, customers(assigned_group_id, groups(teacher_id))')
          .eq('business_id', businessId!)
          .eq('year', yearToFetch);

        if (selectedBranchId) payQuery = payQuery.eq('branch_id', selectedBranchId);
        if (activeFilters.month) payQuery = payQuery.eq('month', activeFilters.month);
        if (activeFilters.payment_status) payQuery = payQuery.eq('status', activeFilters.payment_status);
        else payQuery = payQuery.eq('status', 'Paid');

        const [payRes, monthlyFinRes, reconRes] = await Promise.all([
          payQuery,
          shouldIncludeExpenses
            ? supabase.rpc('get_monthly_financial_summary', {
                p_business_id: businessId!,
                p_year: numericYear,
                p_branch_id: selectedBranchId || null,
              })
            : Promise.resolve({ data: [], error: null }),
          shouldIncludeExpenses && isSalaryAuthorized
            ? supabase.rpc('get_payroll_reconciliation_summary', {
                p_business_id: businessId!,
                p_month: activeFilters.month || null,
                p_year: numericYear,
              })
            : Promise.resolve({ data: null, error: null }),
        ]);

        const pay = unwrapSupabaseQuery(payRes, 'report payments');

        const monthlyData: Record<string, { income: number; expense: number }> = {
          January: { income: 0, expense: 0 },
          February: { income: 0, expense: 0 },
          March: { income: 0, expense: 0 },
          April: { income: 0, expense: 0 },
          May: { income: 0, expense: 0 },
          June: { income: 0, expense: 0 },
          July: { income: 0, expense: 0 },
          August: { income: 0, expense: 0 },
          September: { income: 0, expense: 0 },
          October: { income: 0, expense: 0 },
          November: { income: 0, expense: 0 },
          December: { income: 0, expense: 0 },
        };

        let totalInc = 0;
        let totalExp = 0;
        let standaloneSalaryExp = 0;
        let unresolvedCount = 0;
        let unresolvedAmount = 0;
        let isReconciled = true;

        (pay.data || []).forEach((p: any) => {
          let matches = true;
          if (activeFilters.class_id && p.customers?.assigned_group_id !== activeFilters.class_id) {
            matches = false;
          }
          if (activeFilters.teacher_id && p.customers?.groups?.teacher_id !== activeFilters.teacher_id) {
            matches = false;
          }
          if (matches) {
            totalInc += Number(p.amount);
            if (monthlyData[p.month]) {
              monthlyData[p.month].income += Number(p.amount);
            }
          }
        });

        if (shouldIncludeExpenses) {
          const monthlyRows = unwrapMonthlyFinancialSummaryRpc(monthlyFinRes);
          monthlyRows.forEach((row) => {
            if (monthlyData[row.month_name]) {
              monthlyData[row.month_name].expense = row.total_expenses;
              if (!activeFilters.month || activeFilters.month === row.month_name) {
                totalExp += row.total_expenses;
                standaloneSalaryExp += row.standalone_salary_expenses;
                unresolvedCount += row.unresolved_salary_expense_count;
                unresolvedAmount += row.unresolved_salary_expense_amount;
                if (!row.is_reconciled) {
                  isReconciled = false;
                }
              }
            }
          });
        }

        const reconciliation =
          shouldIncludeExpenses && isSalaryAuthorized
            ? unwrapPayrollReconciliationRpc(reconRes, isSalaryAuthorized, mapPayrollReconciliationRow)
            : null;

        const formattedChart = Object.keys(monthlyData)
          .filter((m) => !activeFilters.month || activeFilters.month === m)
          .map((m) => ({
            name: m.substring(0, 3),
            Income: monthlyData[m].income,
            Expenses: monthlyData[m].expense,
          }));

        return {
          summary: {
            totalIncome: totalInc,
            totalExpenses: totalExp,
            netProfit: totalInc - totalExp,
            standaloneSalaryExpenses: standaloneSalaryExp,
            unresolvedSalaryExpenseCount: unresolvedCount,
            unresolvedSalaryExpenseAmount: unresolvedAmount,
            isReconciled,
          },
          chartData: formattedChart,
          payrollReconciliation: reconciliation,
        };
      },
    });
  }, [userId, businessId, selectedBranchId, activeFilters, currentYear, isSalaryAuthorized]);

  useEffect(() => {
    const seqRef = fetchSeqRef;
    fetchReportData();
    return () => {
      seqRef.current += 1;
    };
  }, [fetchReportData]);

  const filterConfigs: FilterConfig[] = [
    { id: 'year', label: 'Financial Year', type: 'year', defaultValue: currentYear },
    { id: 'month', label: 'Month', type: 'select', options: [
      {label: 'January', value: 'January'}, {label: 'February', value: 'February'},
      {label: 'March', value: 'March'}, {label: 'April', value: 'April'},
      {label: 'May', value: 'May'}, {label: 'June', value: 'June'},
      {label: 'July', value: 'July'}, {label: 'August', value: 'August'},
      {label: 'September', value: 'September'}, {label: 'October', value: 'October'},
      {label: 'November', value: 'November'}, {label: 'December', value: 'December'},
    ]},
    { id: 'class_id', label: t('classes'), type: 'select', options: classes.map(c => ({label: c.name, value: c.id})) },
    { id: 'teacher_id', label: t('teachers'), type: 'select', options: teachers.map(c => ({label: c.name, value: c.id})) },
    { id: 'payment_status', label: 'Payment Status', type: 'select', options: [
      {label: 'Paid', value: 'Paid'},
      {label: 'Pending', value: 'Pending'},
      {label: 'Cancelled', value: 'Cancelled'}
    ], defaultValue: 'Paid'}
  ];

  const handleFilterChange = (filters: Record<string, string>) => {
    setActiveFilters(filters);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="print-only mb-8">
        <h1 className="text-3xl font-bold border-b pb-4 mb-4 text-black">Financial Report</h1>
        <div className="flex justify-between text-gray-800">
          <div>
            <p><strong>Period:</strong> {activeFilters.month ? activeFilters.month : 'Full Year'} {activeFilters.year || currentYear}</p>
            {activeFilters.payment_status && <p><strong>Status Filter:</strong> {activeFilters.payment_status}</p>}
          </div>
          <div className="text-right">
            <p><strong>Generated Date:</strong> {new Date().toLocaleDateString()}</p>
            <p><strong>Generated Time:</strong> {new Date().toLocaleTimeString()}</p>
          </div>
        </div>
      </div>

      <header className="print:hidden flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-bold">{t('reports')}</h1>
          <p className="text-muted">Financial analytics and insights.</p>
        </div>
        <button onClick={() => window.print()} className="btn btn-outline flex items-center gap-2">
          <Printer size={18} /> Print Report
        </button>
      </header>

      <div className="print:hidden">
        <ReportFilters storageKey="reports" configs={filterConfigs} onFilterChange={handleFilterChange} />
      </div>

      {loading || (buildDashboardContextKey(userId, businessId, selectedBranchId, isSalaryAuthorized) !== null && loadedContextKey !== buildDashboardContextKey(userId, businessId, selectedBranchId, isSalaryAuthorized) && !error) ? (
        <div className="p-12 text-center text-muted">Calculating reports...</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-900">Unable to load financial reports</p>
              <p className="text-sm text-red-700 mt-0.5">{error}</p>
            </div>
          </div>
          <button onClick={() => fetchReportData()} className="btn btn-outline">
            Retry
          </button>
        </div>
      ) : (
        <>
          {isSalaryAuthorized && isMultiBranch && payrollReconciliation && payrollReconciliation.unmapped_payroll > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs sm:text-sm text-amber-900">
                <p className="font-semibold">
                  Payroll Reconciliation Notice ({payrollReconciliation.unmapped_payment_count} unmapped historical payment{payrollReconciliation.unmapped_payment_count === 1 ? '' : 's'})
                </p>
                <p className="text-amber-800 mt-0.5">
                  Consolidated Payroll ({formatCurrency(payrollReconciliation.consolidated_payroll)}) = Pauh Jaya Payroll ({formatCurrency(payrollReconciliation.pauh_jaya_payroll)}) + Kelisa Emas Payroll ({formatCurrency(payrollReconciliation.kelisa_emas_payroll)}) + Unmapped Payroll ({formatCurrency(payrollReconciliation.unmapped_payroll)}).
                  {selectedBranchId
                    ? ' Unmapped historical payroll is excluded from this branch report and included only in Consolidated (All Branches) totals until reconciled in Teachers.'
                    : ' Individual branch reports exclude unmapped historical payroll until each record is assigned a branch in Teachers.'}
                </p>
              </div>
            </div>
          )}

          {!summary.isReconciled && summary.unresolvedSalaryExpenseCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs sm:text-sm text-amber-900">
                <p className="font-semibold">
                  Pending Salary Expense Reconciliation ({summary.unresolvedSalaryExpenseCount} unresolved record{summary.unresolvedSalaryExpenseCount === 1 ? '' : 's'} · {formatCurrency(summary.unresolvedSalaryExpenseAmount)})
                </p>
                <p className="text-amber-800 mt-0.5">
                  Total Expenses and Net Profit below reflect confirmed expenses only (including {formatCurrency(summary.standaloneSalaryExpenses)} in confirmed standalone salary expenses). Unresolved Salary expense records are excluded until classified in Expenses.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card flex flex-col gap-2 border-t-4 border-t-blue-500">
              <div className="flex items-center justify-between text-muted">
                <span className="font-medium text-sm">Total Income</span>
                <TrendingUp size={18} className="text-blue-500" />
              </div>
              <span className="text-3xl font-bold">{formatCurrency(summary.totalIncome)}</span>
            </div>

            <div className="card flex flex-col gap-2 border-t-4 border-t-red-500">
              <div className="flex items-center justify-between text-muted">
                <span className="font-medium text-sm">
                  {summary.isReconciled ? 'Total Expenses' : 'Confirmed Expenses (Pending Reconciliation)'}
                </span>
                <TrendingDown size={18} className="text-red-500" />
              </div>
              <span className="text-3xl font-bold">{formatCurrency(summary.totalExpenses)}</span>
            </div>

            <div className="card flex flex-col gap-2 border-t-4 border-t-green-500">
              <div className="flex items-center justify-between text-muted">
                <span className="font-medium text-sm">
                  {summary.isReconciled ? 'Net Profit' : 'Confirmed Net Profit (Pending Reconciliation)'}
                </span>
                <DollarSign size={18} className="text-green-500" />
              </div>
              <span className="text-3xl font-bold">{formatCurrency(summary.netProfit)}</span>
            </div>
          </div>

          <div className="card mt-4">
            <h2 className="text-lg font-semibold mb-4">Income vs Expenses Overview</h2>
            {chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted">
                <DollarSign size={36} className="mb-2 opacity-30 text-gray-400" />
                <p className="font-medium text-gray-600">No financial data available</p>
                <p className="text-xs text-gray-400 mt-1">Try selecting a different financial year or clearing filters.</p>
              </div>
            ) : (
              <div style={{ height: 320, width: '100%', minHeight: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#6B7280', fontSize: 12 }} 
                      dy={8} 
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#6B7280', fontSize: 12 }} 
                      tickFormatter={(v) => `RM${v}`}
                      width={65}
                    />
                    <Tooltip 
                      cursor={{ fill: '#F3F4F6' }}
                      formatter={(value: any) => [formatCurrency(Number(value) || 0), '']}
                      contentStyle={{
                        borderRadius: '8px', 
                        border: '1px solid #E5E7EB', 
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        fontSize: '13px'
                      }}
                    />
                    <Legend 
                      iconType="circle" 
                      wrapperStyle={{ paddingTop: '16px' }} 
                    />
                    <Bar dataKey="Income" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={48} />
                    <Bar dataKey="Expenses" fill="#EF4444" radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
