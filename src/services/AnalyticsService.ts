import { supabase } from '../lib/supabase';

export interface AnalyticsFilters {
  year: string;
  month?: string;
  class_id?: string;
  teacher_id?: string;
}

export class AnalyticsService {
  /**
   * Retrieves high-level trend data for the given year/filters.
   */
  static async getFinancialTrends(businessId: string, filters: AnalyticsFilters) {
    let payQuery = supabase.from('payments').select('amount, month, status').eq('business_id', businessId).eq('year', filters.year).is('deleted_at', null);
    let expQuery = supabase.from('expenses').select('amount, date').eq('business_id', businessId).gte('date', `${filters.year}-01-01`).lte('date', `${filters.year}-12-31`).is('deleted_at', null);
    
    if (filters.month) payQuery = payQuery.eq('month', filters.month);

    const [payRes, expRes] = await Promise.all([payQuery, expQuery]);

    const data: Record<string, { income: number, expense: number, outstanding: number }> = {
      'January': { income: 0, expense: 0, outstanding: 0 },
      'February': { income: 0, expense: 0, outstanding: 0 },
      'March': { income: 0, expense: 0, outstanding: 0 },
      'April': { income: 0, expense: 0, outstanding: 0 },
      'May': { income: 0, expense: 0, outstanding: 0 },
      'June': { income: 0, expense: 0, outstanding: 0 },
      'July': { income: 0, expense: 0, outstanding: 0 },
      'August': { income: 0, expense: 0, outstanding: 0 },
      'September': { income: 0, expense: 0, outstanding: 0 },
      'October': { income: 0, expense: 0, outstanding: 0 },
      'November': { income: 0, expense: 0, outstanding: 0 },
      'December': { income: 0, expense: 0, outstanding: 0 },
    };

    if (payRes.data) {
      payRes.data.forEach(p => {
        if (p.status === 'Paid') data[p.month].income += Number(p.amount);
        if (p.status === 'Pending') data[p.month].outstanding += Number(p.amount);
      });
    }

    if (expRes.data) {
      expRes.data.forEach(e => {
        // @ts-ignore
        const expenseMonth = new Date(e.date).toLocaleString('default', { month: 'long' });
        const monthIndex = new Date(e.date).getMonth();
        const monthNames = Object.keys(data);
        if (monthNames[monthIndex]) {
          data[monthNames[monthIndex]].expense += Number(e.amount);
        }
      });
    }

    return Object.keys(data)
      .filter(m => !filters.month || filters.month === m)
      .map(m => ({
        month: m.substring(0, 3),
        Income: data[m].income,
        Expenses: data[m].expense,
        Profit: data[m].income - data[m].expense,
        Outstanding: data[m].outstanding
      }));
  }

  static async getPaymentMethods(businessId: string, filters: AnalyticsFilters) {
    const { data } = await supabase.from('payments')
      .select('payment_method, amount')
      .eq('business_id', businessId)
      .eq('year', filters.year)
      .eq('status', 'Paid')
      .is('deleted_at', null);
      
    if (!data) return [];
    
    const methods: Record<string, number> = {};
    data.forEach(d => {
      methods[d.payment_method] = (methods[d.payment_method] || 0) + Number(d.amount);
    });
    
    return Object.keys(methods).map(m => ({ name: m, value: methods[m] }));
  }
}
