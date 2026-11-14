import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { formatCurrency } from '../lib/currency';
import {
  EMPTY_DASHBOARD_STATS,
  PayrollReconciliationSummary,
  buildDashboardContextKey,
  executeDashboardFetch,
  filterVisibleExpenses,
  mapPayrollReconciliationRow,
  unwrapFinancialSummaryRpc,
  unwrapSupabaseQuery,
  unwrapPayrollReconciliationRpc,
} from '../lib/dashboardFetch';
import { useNavigate } from 'react-router-dom';
import {
  Users, BookOpen, CreditCard, TrendingUp, TrendingDown,
  GraduationCap, Plus, ArrowRight, CheckCircle, AlertCircle,
  BarChart2, Receipt, Zap, Calendar, Building2
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardStats {
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

interface RecentPayment {
  id: string;
  amount: number;
  status: string;
  month: string;
  year: number;
  payment_date: string;
  customers?: { name: string };
}

interface RecentExpense {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
}

interface MonthlyTrend {
  label: string;
  Income: number;
  Expenses: number;
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

const ChartTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: '8px',
        padding: '10px 14px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        fontSize: '0.8rem'
      }}>
        <p style={{ fontWeight: 600, marginBottom: 4, color: '#111827' }}>{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.name} style={{ color: entry.color, margin: '2px 0' }}>
            {entry.name}: {formatCurrency(entry.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// ─── Component ────────────────────────────────────────────────────────────────

export const Dashboard: React.FC = () => {
  const { t, modules } = useTemplate();
  const { user, businessId, displayName, businessName, isSalaryAuthorized } = useAuth();
  const userId = user?.id ?? null;
  const { selectedBranchId, selectedBranch, isMultiBranch } = useBranch();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_DASHBOARD_STATS);
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([]);
  const [recentExpenses, setRecentExpenses] = useState<RecentExpense[]>([]);
  const [trendData, setTrendData] = useState<MonthlyTrend[]>([]);
  const [payrollReconciliation, setPayrollReconciliation] = useState<PayrollReconciliationSummary | null>(null);
  const fetchSeqRef = useRef(0);

  const fetchDashboardStats = useCallback(async () => {
    const now = new Date();
    const currentMonth = now.toLocaleString('default', { month: 'long' });
    const currentYear = now.getFullYear();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // Build 6-month trend window
    const months: { label: string; monthName: string; year: number; firstDay: string; lastDay: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleString('default', { month: 'short' }),
        monthName: d.toLocaleString('default', { month: 'long' }),
        year: d.getFullYear(),
        firstDay: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0],
        lastDay: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0],
      });
    }

    // Centralized financial summary helper:
    // Total Expenses = Non-Salary Expenses + Authoritative Teacher Payroll (staff_payments)
    const fetchFinancialSummary = async (
      startDate: string,
      endDate: string,
      monthName: string,
      yr: number
    ) => {
      if (!businessId) {
        throw new Error('Business context is required to load financial summary.');
      }
      const result = await supabase.rpc('get_financial_summary', {
        p_business_id: businessId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_month: monthName,
        p_year: yr,
        p_branch_id: selectedBranchId || null,
      });
      return unwrapFinancialSummaryRpc(result);
    };

    // Helper to fetch payroll reconciliation summary for Puan Hana (isSalaryAuthorized)
    const fetchPayrollReconciliation = async (monthName: string, yr: number): Promise<PayrollReconciliationSummary | null> => {
      if (!businessId || !isSalaryAuthorized) return null;
      const result = await supabase.rpc('get_payroll_reconciliation_summary', {
        p_business_id: businessId,
        p_month: monthName,
        p_year: yr,
      });
      return unwrapPayrollReconciliationRpc(result, isSalaryAuthorized, mapPayrollReconciliationRow);
    };

    await executeDashboardFetch<RecentPayment, RecentExpense, MonthlyTrend, PayrollReconciliationSummary>({
      seqRef: fetchSeqRef,
      userId,
      businessId,
      selectedBranchId,
      isSalaryAuthorized,
      callbacks: {
        setLoading,
        setError,
        setLoadedContextKey,
        setStats,
        setRecentPayments,
        setRecentExpenses,
        setTrendData,
        setPayrollReconciliation,
      },
      loadPrimary: async () => {
        // Branch-isolated queries for students, classes, pending payments, recent activity, and teachers
        let pendingQuery = supabase.from('payments').select('amount').eq('business_id', businessId!).eq('month', currentMonth).eq('year', currentYear).eq('status', 'Pending');
        let studentsQuery = supabase.from('customers').select('*', { count: 'exact', head: true }).eq('business_id', businessId!).eq('status', 'Active');
        let classesQuery = supabase.from('groups').select('*', { count: 'exact', head: true }).eq('business_id', businessId!).eq('status', 'Active');
        let staffQuery = supabase.from('staff').select('id', { count: 'exact', head: true }).eq('business_id', businessId!);
        let recentPayQuery = supabase.from('payments').select('*, customers(name)').eq('business_id', businessId!).order('payment_date', { ascending: false }).limit(5);
        let recentExpQuery = supabase.from('expenses').select('*').eq('business_id', businessId!).order('date', { ascending: false }).limit(5);

        if (selectedBranchId) {
          pendingQuery = pendingQuery.eq('branch_id', selectedBranchId);
          studentsQuery = studentsQuery.eq('branch_id', selectedBranchId);
          classesQuery = classesQuery.eq('branch_id', selectedBranchId);
          staffQuery = staffQuery.eq('branch_id', selectedBranchId);
          recentPayQuery = recentPayQuery.eq('branch_id', selectedBranchId);
          recentExpQuery = recentExpQuery.eq('branch_id', selectedBranchId);
        }

        const [
          financialSummary, pendingRes,
          studentsRes, classesRes, staffRes,
          recentPayRes, recentExpRes, reconciliationRes,
        ] = await Promise.all([
          fetchFinancialSummary(firstDay, lastDay, currentMonth, currentYear),
          pendingQuery,
          studentsQuery,
          classesQuery,
          staffQuery,
          recentPayQuery,
          recentExpQuery,
          fetchPayrollReconciliation(currentMonth, currentYear),
        ]);

        const pendingPayments = unwrapSupabaseQuery(pendingRes, 'pending payments');
        const students = unwrapSupabaseQuery(studentsRes, 'students count');
        const classes = unwrapSupabaseQuery(classesRes, 'classes count');
        const staff = unwrapSupabaseQuery(staffRes, 'staff count');
        const recentPay = unwrapSupabaseQuery(recentPayRes, 'recent payments');
        const recentExp = unwrapSupabaseQuery(recentExpRes, 'recent expenses');

        const outstanding = (pendingPayments.data || []).reduce((a, c) => a + Number(c.amount), 0);

        return {
          payrollReconciliation: reconciliationRes,
          stats: {
            monthlyCollection: financialSummary.collections,
            monthlyExpenses: financialSummary.total_expenses,
            netProfit: financialSummary.net_profit,
            outstandingPayment: outstanding,
            totalStudents: students.count || 0,
            totalClasses: classes.count || 0,
            totalTeachers: staff.count || 0,
            standaloneSalaryExpenses: financialSummary.standalone_salary_expenses,
            unresolvedSalaryExpenseCount: financialSummary.unresolved_salary_expense_count,
            unresolvedSalaryExpenseAmount: financialSummary.unresolved_salary_expense_amount,
            isReconciled: financialSummary.is_reconciled,
          },
          recentPayments: recentPay.data || [],
          recentExpenses: filterVisibleExpenses(recentExp.data || [], isSalaryAuthorized),
        };
      },
      loadTrend: async () => {
        return Promise.all(
          months.map(async (m) => {
            const summary = await fetchFinancialSummary(m.firstDay, m.lastDay, m.monthName, m.year);
            return { label: m.label, Income: summary.collections, Expenses: summary.total_expenses };
          })
        );
      },
    });
  }, [userId, businessId, selectedBranchId, isSalaryAuthorized]);

  useEffect(() => {
    const seqRef = fetchSeqRef;
    fetchDashboardStats();
    return () => {
      seqRef.current += 1;
    };
  }, [fetchDashboardStats]);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const todayStr = new Date().toLocaleDateString('en-MY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const currentContextKey = buildDashboardContextKey(
    userId,
    businessId,
    selectedBranchId,
    isSalaryAuthorized
  );
  const isContextSynced = currentContextKey !== null && loadedContextKey === currentContextKey;

  // ─── Loading skeleton ───────────────────────────────────────────────────────

  if (loading || (!error && currentContextKey !== null && !isContextSynced)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div style={styles.header}>
          <div>
            <div style={{ ...styles.skeleton, width: 240, height: 28, marginBottom: 8 }} />
            <div style={{ ...styles.skeleton, width: 180, height: 16 }} />
          </div>
        </div>
        <div style={styles.kpiGrid}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{ ...styles.kpiCard, padding: '1.5rem' }}>
              <div style={{ ...styles.skeleton, width: 80, height: 14, marginBottom: 12 }} />
              <div style={{ ...styles.skeleton, width: 120, height: 28 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const isHealthy = stats.netProfit >= 0;
  const collectionRate = stats.monthlyCollection + stats.outstandingPayment > 0
    ? Math.round((stats.monthlyCollection / (stats.monthlyCollection + stats.outstandingPayment)) * 100)
    : 0;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

      {/* ── WELCOME HEADER ── */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.welcomeTitle}>{greeting()}, {displayName}! 👋</h1>
          <p style={styles.welcomeSub}>
            {businessName ? `Welcome back to ${businessName} · ` : ''}{todayStr}
            {isMultiBranch && (
              <span className="ml-2 inline-flex items-center gap-1 font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-xs border border-blue-200">
                <Building2 size={12} />
                {selectedBranch ? selectedBranch.name : 'All Branches'}
              </span>
            )}
          </p>
        </div>
        <div style={styles.headerBadge}>
          <div style={{ ...styles.statusDot, background: isHealthy ? '#10B981' : '#EF4444' }} />
          <span style={styles.statusText}>{isHealthy ? 'Business Healthy' : 'Review Finances'}</span>
        </div>
      </div>

      {/* ── ERROR BANNER (SAFE FAIL-CLOSED STATE) ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm text-red-900">
              <p className="font-semibold">Financial Data Unavailable</p>
              <p className="text-red-800 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchDashboardStats()}
            className="text-xs font-semibold text-red-900 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg border border-red-300 transition-colors whitespace-nowrap self-start sm:self-center"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── UNMAPPED HISTORICAL PAYROLL RECONCILIATION BANNER (PUAN HANA ONLY) ── */}
      {isSalaryAuthorized && isMultiBranch && payrollReconciliation && payrollReconciliation.unmapped_payroll > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm text-amber-900">
              <p className="font-semibold">
                Unmapped Historical Payroll Detected ({payrollReconciliation.unmapped_payment_count} record{payrollReconciliation.unmapped_payment_count === 1 ? '' : 's'})
              </p>
              <p className="text-amber-800 mt-0.5">
                Consolidated Payroll ({formatCurrency(payrollReconciliation.consolidated_payroll)}) = Pauh Jaya ({formatCurrency(payrollReconciliation.pauh_jaya_payroll)}) + Kelisa Emas ({formatCurrency(payrollReconciliation.kelisa_emas_payroll)}) + Unmapped Payroll ({formatCurrency(payrollReconciliation.unmapped_payroll)}).
                {selectedBranchId
                  ? ' Unmapped historical payroll is excluded from individual branch totals until reconciled.'
                  : ' Branch totals will not sum to Consolidated Payroll until unmapped historical payments are assigned a branch.'}
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/teachers')}
            className="btn btn-outline text-xs whitespace-nowrap self-start sm:self-center"
          >
            Reconcile Payroll
          </button>
        </div>
      )}

      {/* ── UNRESOLVED SALARY EXPENSE RECONCILIATION BANNER ── */}
      {!stats.isReconciled && stats.unresolvedSalaryExpenseCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm text-amber-900">
              <p className="font-semibold">
                Pending Salary Expense Reconciliation ({stats.unresolvedSalaryExpenseCount} unresolved record{stats.unresolvedSalaryExpenseCount === 1 ? '' : 's'} · {formatCurrency(stats.unresolvedSalaryExpenseAmount)})
              </p>
              <p className="text-amber-800 mt-0.5">
                Confirmed Expenses ({formatCurrency(stats.monthlyExpenses)}) and Net Profit ({formatCurrency(stats.netProfit)}) exclude unresolved Salary expense records until classified as Linked Payroll Duplicate or Confirmed Standalone Expense.
              </p>
            </div>
          </div>
          {isSalaryAuthorized && (
            <button
              onClick={() => navigate('/expenses')}
              className="btn btn-outline text-xs whitespace-nowrap self-start sm:self-center"
            >
              Reconcile Expenses
            </button>
          )}
        </div>
      )}

      {/* ── KPI CARDS ── */}
      <div style={styles.kpiGrid}>
        <KpiCard
          label={`Active ${t('students')}`}
          value={String(stats.totalStudents)}
          icon={<Users size={20} />}
          iconBg="#EFF6FF"
          iconColor="#3B82F6"
          suffix="enrolled"
          onClick={() => navigate('/students')}
        />
        <KpiCard
          label={`${t('teachers')}`}
          value={String(stats.totalTeachers)}
          icon={<GraduationCap size={20} />}
          iconBg="#F0FDF4"
          iconColor="#10B981"
          suffix="active"
          onClick={isSalaryAuthorized ? () => navigate('/teachers') : undefined}
        />
        <KpiCard
          label={`Active ${t('classes')}`}
          value={String(stats.totalClasses)}
          icon={<BookOpen size={20} />}
          iconBg="#FFF7ED"
          iconColor="#F97316"
          suffix="running"
          onClick={() => navigate('/classes')}
        />
        <KpiCard
          label="Monthly Revenue"
          value={formatCurrency(stats.monthlyCollection)}
          icon={<TrendingUp size={20} />}
          iconBg="#EFF6FF"
          iconColor="#3B82F6"
          suffix={`${collectionRate}% collected`}
          trend={stats.monthlyCollection > 0 ? 'up' : 'neutral'}
          onClick={() => navigate('/payments')}
        />
        <KpiCard
          label="Outstanding"
          value={formatCurrency(stats.outstandingPayment)}
          icon={<AlertCircle size={20} />}
          iconBg="#FFFBEB"
          iconColor="#F59E0B"
          suffix="pending"
          trend={stats.outstandingPayment > 0 ? 'down' : 'neutral'}
          onClick={() => navigate('/payments')}
        />
      </div>

      {/* ── CHART + SUMMARY ROW ── */}
      <div style={styles.twoColGrid}>

        {/* Revenue Overview Chart */}
        <div style={{ ...styles.card, padding: '1.5rem', gridColumn: 'span 2' }}>
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.cardTitle}>Revenue Overview</h2>
              <p style={styles.cardSub}>Income vs Expenses — last 6 months</p>
            </div>
            <button style={styles.linkBtn} onClick={() => navigate('/analytics')}>
              View Analytics <ArrowRight size={14} />
            </button>
          </div>
          <div style={{ height: 220, marginTop: '1rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9CA3AF' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9CA3AF' }} tickFormatter={(v) => `RM${(v / 1000).toFixed(0)}k`} width={55} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="Income" stroke="#3B82F6" strokeWidth={2.5} fill="url(#colorIncome)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#3B82F6' }} />
                <Area type="monotone" dataKey="Expenses" stroke="#EF4444" strokeWidth={2} fill="url(#colorExpenses)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#EF4444' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── TABLES + QUICK ACTIONS ROW ── */}
      <div style={styles.threeColGrid}>

        {/* Recent Payments */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.cardTitle}>Recent Payments</h2>
              <p style={styles.cardSub}>Latest 5 transactions</p>
            </div>
            <button style={styles.linkBtn} onClick={() => navigate('/payments')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          <div style={{ marginTop: '1rem' }}>
            {recentPayments.length === 0 ? (
              <EmptyFeed icon={<CreditCard size={28} color="#D1D5DB" />} message="No payments yet" />
            ) : (
              recentPayments.map((p) => (
                <div key={p.id} style={styles.feedRow}>
                  <div style={{ ...styles.feedIcon, background: p.status === 'Paid' ? '#F0FDF4' : '#FFFBEB' }}>
                    <CreditCard size={14} color={p.status === 'Paid' ? '#10B981' : '#F59E0B'} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={styles.feedName}>{p.customers?.name || '—'}</p>
                    <p style={styles.feedMeta}>{p.month} {p.year}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#111827' }}>{formatCurrency(p.amount)}</p>
                    <span style={{ ...styles.badge, ...(p.status === 'Paid' ? styles.badgeGreen : styles.badgeYellow) }}>
                      {p.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Expenses */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.cardTitle}>Recent Expenses</h2>
              <p style={styles.cardSub}>Latest 5 entries</p>
            </div>
            <button style={styles.linkBtn} onClick={() => navigate('/expenses')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          <div style={{ marginTop: '1rem' }}>
            {recentExpenses.length === 0 ? (
              <EmptyFeed icon={<Receipt size={28} color="#D1D5DB" />} message="No expenses yet" />
            ) : (
              recentExpenses.map((e) => (
                <div key={e.id} style={styles.feedRow}>
                  <div style={{ ...styles.feedIcon, background: '#FEF2F2' }}>
                    <Receipt size={14} color="#EF4444" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={styles.feedName}>{e.category}</p>
                    <p style={styles.feedMeta}>{e.description || '—'}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#EF4444' }}>−{formatCurrency(e.amount)}</p>
                    <p style={{ fontSize: '0.7rem', color: '#9CA3AF', marginTop: 2 }}>
                      {e.date ? new Date(e.date).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right column: Quick Actions + Business Summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Quick Actions */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <h2 style={styles.cardTitle}>Quick Actions</h2>
                <p style={styles.cardSub}>Jump to a task</p>
              </div>
              <Zap size={16} color="#F59E0B" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
              {modules.students && (
                <QuickAction icon={<Users size={15} />} label={`Add ${t('students').slice(0, -1)}`} color="#3B82F6" onClick={() => navigate('/students')} />
              )}
              {modules.teachers && isSalaryAuthorized && (
                <QuickAction icon={<GraduationCap size={15} />} label={`Add ${t('teachers').slice(0, -1)}`} color="#10B981" onClick={() => navigate('/teachers')} />
              )}
              {modules.classes && (
                <QuickAction icon={<BookOpen size={15} />} label={`Add ${t('classes').slice(0, -1)}`} color="#F97316" onClick={() => navigate('/classes')} />
              )}
              {modules.payments && (
                <QuickAction icon={<CreditCard size={15} />} label="Record Payment" color="#8B5CF6" onClick={() => navigate('/payments')} />
              )}
              {modules.expenses && (
                <QuickAction icon={<Receipt size={15} />} label="Record Expense" color="#EF4444" onClick={() => navigate('/expenses')} />
              )}
            </div>
          </div>

          {/* Business Summary */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <h2 style={styles.cardTitle}>This Month</h2>
                <p style={styles.cardSub}>Financial summary</p>
              </div>
              <BarChart2 size={16} color="#9CA3AF" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
              <SummaryRow label="Revenue" value={formatCurrency(stats.monthlyCollection)} color="#3B82F6" />
              <SummaryRow label="Expenses" value={formatCurrency(stats.monthlyExpenses)} color="#EF4444" />
              <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: '0.75rem' }}>
                <SummaryRow
                  label="Net Profit"
                  value={formatCurrency(stats.netProfit)}
                  color={stats.netProfit >= 0 ? '#10B981' : '#EF4444'}
                  bold
                />
              </div>
            </div>
          </div>

          {/* Today's Focus */}
          <div style={{ ...styles.card, background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)', border: '1px solid #BFDBFE' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <Calendar size={16} color="#3B82F6" />
              <h2 style={{ ...styles.cardTitle, color: '#1E40AF' }}>Today's Focus</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {stats.outstandingPayment > 0 && (
                <FocusItem
                  icon={<AlertCircle size={14} color="#F59E0B" />}
                  text={`${formatCurrency(stats.outstandingPayment)} in outstanding payments`}
                />
              )}
              {stats.totalStudents === 0 && (
                <FocusItem
                  icon={<Plus size={14} color="#3B82F6" />}
                  text={`Add your first ${t('students').toLowerCase()}`}
                />
              )}
              {stats.totalClasses === 0 && (
                <FocusItem
                  icon={<Plus size={14} color="#3B82F6" />}
                  text={`Create your first ${t('classes').toLowerCase()}`}
                />
              )}
              {stats.outstandingPayment === 0 && stats.totalStudents > 0 && (
                <FocusItem
                  icon={<CheckCircle size={14} color="#10B981" />}
                  text="All payments collected — great work!"
                />
              )}
              {stats.netProfit > 0 && (
                <FocusItem
                  icon={<TrendingUp size={14} color="#10B981" />}
                  text={`Profitable month: ${formatCurrency(stats.netProfit)}`}
                />
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const KpiCard: React.FC<{
  label: string; value: string; icon: React.ReactNode;
  iconBg: string; iconColor: string; suffix?: string;
  trend?: 'up' | 'down' | 'neutral'; onClick?: () => void;
}> = ({ label, value, icon, iconBg, suffix, trend, onClick }) => (
  <div
    style={{ ...styles.kpiCard, cursor: onClick ? 'pointer' : 'default' }}
    onClick={onClick}
    role={onClick ? 'button' : undefined}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
      <p style={styles.kpiLabel}>{label}</p>
      <div style={{ ...styles.kpiIconWrap, background: iconBg }}>
        {icon}
      </div>
    </div>
    <p style={styles.kpiValue}>{value}</p>
    {suffix && (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.5rem' }}>
        {trend === 'up' && <TrendingUp size={12} color="#10B981" />}
        {trend === 'down' && <TrendingDown size={12} color="#F59E0B" />}
        <span style={{ fontSize: '0.73rem', color: '#9CA3AF' }}>{suffix}</span>
      </div>
    )}
  </div>
);

const QuickAction: React.FC<{ icon: React.ReactNode; label: string; color: string; onClick: () => void }> = ({ icon, label, color, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex', alignItems: 'center', gap: '0.625rem',
      padding: '0.5rem 0.75rem', borderRadius: '8px',
      border: '1px solid #F3F4F6', background: '#FAFAFA',
      cursor: 'pointer', width: '100%', textAlign: 'left',
      fontSize: '0.825rem', fontWeight: 500, color: '#374151',
      transition: 'background 0.15s, border-color 0.15s',
    }}
    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#F0F7FF'; (e.currentTarget as HTMLElement).style.borderColor = '#BFDBFE'; }}
    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#FAFAFA'; (e.currentTarget as HTMLElement).style.borderColor = '#F3F4F6'; }}
  >
    <span style={{ color, display: 'flex' }}>{icon}</span>
    {label}
    <ArrowRight size={13} color="#D1D5DB" style={{ marginLeft: 'auto' }} />
  </button>
);

const SummaryRow: React.FC<{ label: string; value: string; color: string; bold?: boolean }> = ({ label, value, color, bold }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span style={{ fontSize: '0.825rem', color: '#6B7280', fontWeight: bold ? 600 : 400 }}>{label}</span>
    <span style={{ fontSize: '0.9rem', fontWeight: bold ? 700 : 600, color }}>{value}</span>
  </div>
);

const FocusItem: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
    {icon}
    <span style={{ fontSize: '0.8rem', color: '#1E40AF' }}>{text}</span>
  </div>
);

const EmptyFeed: React.FC<{ icon: React.ReactNode; message: string }> = ({ icon, message }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem 1rem', gap: '0.5rem' }}>
    {icon}
    <p style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>{message}</p>
  </div>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  welcomeTitle: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#111827',
    margin: 0,
    lineHeight: 1.2,
  },
  welcomeSub: {
    fontSize: '0.85rem',
    color: '#9CA3AF',
    margin: '0.25rem 0 0 0',
  },
  headerBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.4rem 1rem',
    borderRadius: '999px',
    background: '#F9FAFB',
    border: '1px solid #E5E7EB',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  statusText: {
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#374151',
  },

  // KPI Grid
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '1.25rem',
  },
  kpiCard: {
    background: '#FFFFFF',
    borderRadius: '14px',
    padding: '1.375rem 1.5rem',
    border: '1px solid #E5E7EB',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)',
    transition: 'box-shadow 0.2s, transform 0.15s',
  },
  kpiLabel: {
    fontSize: '0.775rem',
    fontWeight: 500,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    margin: 0,
  },
  kpiValue: {
    fontSize: '1.6rem',
    fontWeight: 800,
    color: '#111827',
    margin: 0,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
  },
  kpiIconWrap: {
    width: 38,
    height: 38,
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // Charts
  twoColGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '1.25rem',
  },
  threeColGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '1.25rem',
    alignItems: 'start',
  },

  // Generic card
  card: {
    background: '#FFFFFF',
    borderRadius: '14px',
    padding: '1.375rem',
    border: '1px solid #E5E7EB',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: '#111827',
    margin: 0,
  },
  cardSub: {
    fontSize: '0.75rem',
    color: '#9CA3AF',
    margin: '0.15rem 0 0 0',
  },
  linkBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.78rem',
    color: '#3B82F6',
    fontWeight: 500,
    padding: '0.2rem 0',
  },

  // Feed rows
  feedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.625rem 0',
    borderBottom: '1px solid #F9FAFB',
  },
  feedIcon: {
    width: 32,
    height: 32,
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  feedName: {
    fontSize: '0.825rem',
    fontWeight: 600,
    color: '#111827',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  feedMeta: {
    fontSize: '0.72rem',
    color: '#9CA3AF',
    margin: '0.1rem 0 0 0',
  },

  // Badges
  badge: {
    display: 'inline-block',
    padding: '0.1rem 0.45rem',
    borderRadius: '999px',
    fontSize: '0.65rem',
    fontWeight: 600,
    marginTop: '0.2rem',
  },
  badgeGreen: { background: '#D1FAE5', color: '#065F46' },
  badgeYellow: { background: '#FEF3C7', color: '#92400E' },

  // Skeleton
  skeleton: {
    background: 'linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%)',
    backgroundSize: '200% 100%',
    borderRadius: '6px',
    animation: 'shimmer 1.5s infinite',
  },
};
