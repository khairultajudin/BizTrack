import React, { useEffect, useState, useCallback } from 'react';
import { useTemplate } from '../context/TemplateContext';
import { useAuth } from '../context/AuthContext';
import { AnalyticsService } from '../services/AnalyticsService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { ReportFilters, FilterConfig } from '../components/ui/ReportFilters';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export const Analytics: React.FC = () => {
  const {} = useTemplate();
  const { businessId } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [trendData, setTrendData] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const currentYear = new Date().getFullYear().toString();
  
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({
    year: currentYear
  });

  const fetchAnalytics = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    
    const filters = { year: activeFilters.year || currentYear, month: activeFilters.month };
    const [trends, methods] = await Promise.all([
      AnalyticsService.getFinancialTrends(businessId, filters),
      AnalyticsService.getPaymentMethods(businessId, filters)
    ]);
    
    setTrendData(trends);
    setPaymentMethods(methods);
    setLoading(false);
  }, [businessId, activeFilters, currentYear]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const filterConfigs: FilterConfig[] = [
    { id: 'year', label: 'Financial Year', type: 'year', defaultValue: currentYear },
    { id: 'month', label: 'Month', type: 'select', options: [
      {label: 'January', value: 'January'}, {label: 'February', value: 'February'},
      {label: 'March', value: 'March'}, {label: 'April', value: 'April'},
      {label: 'May', value: 'May'}, {label: 'June', value: 'June'},
      {label: 'July', value: 'July'}, {label: 'August', value: 'August'},
      {label: 'September', value: 'September'}, {label: 'October', value: 'October'},
      {label: 'November', value: 'November'}, {label: 'December', value: 'December'},
    ]}
  ];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <PieChartIcon size={24} />
          Advanced Analytics
        </h1>
        <p className="text-muted">Deep dive into business metrics and trends.</p>
      </header>

      <ReportFilters storageKey="analytics" configs={filterConfigs} onFilterChange={setActiveFilters} />

      {loading ? (
        <div className="p-12 text-center text-muted">Calculating analytics...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          <div className="card h-96 p-6">
            <h2 className="text-lg font-semibold mb-6">Income vs Expenses (Growth)</h2>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Income" stroke="var(--primary)" strokeWidth={3} />
                <Line type="monotone" dataKey="Expenses" stroke="#EF4444" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card h-96 p-6">
            <h2 className="text-lg font-semibold mb-6">Net Profit & Outstanding Trends</h2>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Profit" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Outstanding" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card h-96 p-6">
            <h2 className="text-lg font-semibold mb-6">Payment Method Analysis</h2>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={paymentMethods} cx="50%" cy="50%" innerRadius={60} outerRadius={100} fill="#8884d8" paddingAngle={5} dataKey="value" label>
                  {paymentMethods.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

        </div>
      )}
    </div>
  );
};
