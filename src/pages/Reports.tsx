import React, { useEffect, useState, useCallback } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { TrendingUp, TrendingDown, DollarSign, Printer } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ReportFilters, type FilterConfig } from '../components/ui/ReportFilters';
import { formatCurrency } from '../lib/currency';

export const Reports: React.FC = () => {
  const { t, settings } = useTemplate();
  const { businessId } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalIncome: 0,
    totalExpenses: 0,
    netProfit: 0,
  });
  
  const [chartData, setChartData] = useState<any[]>([]);
  const currentYear = new Date().getFullYear().toString();
  
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({
    year: currentYear
  });

  const [classes, setClasses] = useState<{id: string, name: string}[]>([]);
  const [teachers, setTeachers] = useState<{id: string, name: string}[]>([]);

  useEffect(() => {
    if (!businessId) return;
    const fetchSelectOptions = async () => {
      const [grpRes, staffRes] = await Promise.all([
        supabase.from('groups').select('id, name').eq('business_id', businessId),
        supabase.from('staff').select('id, name').eq('business_id', businessId)
      ]);
      if (grpRes.data) setClasses(grpRes.data);
      if (staffRes.data) setTeachers(staffRes.data);
    };
    fetchSelectOptions();
  }, [businessId]);

  const fetchReportData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    
    const yearToFetch = activeFilters.year || currentYear;
    
    // Fetch Payments
    let payQuery = supabase.from('payments').select('amount, month, status, customers(assigned_group_id, groups(teacher_id))').eq('business_id', businessId).eq('year', yearToFetch);
    
    if (activeFilters.month) payQuery = payQuery.eq('month', activeFilters.month);
    if (activeFilters.payment_status) payQuery = payQuery.eq('status', activeFilters.payment_status);
    else payQuery = payQuery.eq('status', 'Paid'); // Default if no filter
    
    // Fetch Expenses
    let expQuery = supabase.from('expenses').select('amount, date').eq('business_id', businessId).gte('date', `${yearToFetch}-01-01`).lte('date', `${yearToFetch}-12-31`);
    
    const [payRes, expRes] = await Promise.all([payQuery, expQuery]);
    
    let totalInc = 0;
    let totalExp = 0;
    
    const monthlyData: Record<string, { income: number, expense: number }> = {
      'January': { income: 0, expense: 0 },
      'February': { income: 0, expense: 0 },
      'March': { income: 0, expense: 0 },
      'April': { income: 0, expense: 0 },
      'May': { income: 0, expense: 0 },
      'June': { income: 0, expense: 0 },
      'July': { income: 0, expense: 0 },
      'August': { income: 0, expense: 0 },
      'September': { income: 0, expense: 0 },
      'October': { income: 0, expense: 0 },
      'November': { income: 0, expense: 0 },
      'December': { income: 0, expense: 0 },
    };

    if (payRes.data) {
      payRes.data.forEach((p: any) => {
        // Client-side filtering for joined tables since PostgREST makes deep filtering tricky
        let matches = true;
        
        if (activeFilters.class_id) {
          if (p.customers?.assigned_group_id !== activeFilters.class_id) matches = false;
        }
        
        if (activeFilters.teacher_id) {
          if (p.customers?.groups?.teacher_id !== activeFilters.teacher_id) matches = false;
        }

        if (matches) {
          totalInc += Number(p.amount);
          if (monthlyData[p.month]) {
            monthlyData[p.month].income += Number(p.amount);
          }
        }
      });
    }

    if (expRes.data) {
      expRes.data.forEach((e: any) => {
        const expenseMonth = new Date(e.date).toLocaleString('default', { month: 'long' });
        
        // If we are filtering by Class or Teacher, it doesn't make sense to show business expenses.
        // So we only count expenses if those filters are empty.
        if (!activeFilters.class_id && !activeFilters.teacher_id) {
          if (!activeFilters.month || activeFilters.month === expenseMonth) {
            totalExp += Number(e.amount);
          }
          
          const monthIndex = new Date(e.date).getMonth();
          const monthNames = Object.keys(monthlyData);
          if (monthNames[monthIndex]) {
            monthlyData[monthNames[monthIndex]].expense += Number(e.amount);
          }
        }
      });
    }

    setSummary({
      totalIncome: totalInc,
      totalExpenses: totalExp,
      netProfit: totalInc - totalExp
    });

    const formattedChart = Object.keys(monthlyData)
      .filter(m => !activeFilters.month || activeFilters.month === m)
      .map(m => ({
        name: m.substring(0, 3),
        Income: monthlyData[m].income,
        Expenses: monthlyData[m].expense,
      }));

    setChartData(formattedChart);
    setLoading(false);
  }, [businessId, activeFilters, currentYear]);

  useEffect(() => {
    fetchReportData();
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

      {loading ? (
        <div className="p-12 text-center text-muted">Calculating reports...</div>
      ) : (
        <>
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
                <span className="font-medium text-sm">Total Expenses</span>
                <TrendingDown size={18} className="text-red-500" />
              </div>
              <span className="text-3xl font-bold">{formatCurrency(summary.totalExpenses)}</span>
            </div>

            <div className="card flex flex-col gap-2 border-t-4 border-t-green-500">
              <div className="flex items-center justify-between text-muted">
                <span className="font-medium text-sm">Net Profit</span>
                <DollarSign size={18} className="text-green-500" />
              </div>
              <span className="text-3xl font-bold">{formatCurrency(summary.netProfit)}</span>
            </div>
          </div>

          <div className="card h-96 p-6 mt-4">
            <h2 className="text-lg font-semibold mb-6">Income vs Expenses Overview</h2>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12}} />
                <Tooltip 
                  cursor={{fill: '#F3F4F6'}}
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                />
                <Legend iconType="circle" wrapperStyle={{paddingTop: '20px'}} />
                <Bar dataKey="Income" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expenses" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
};
