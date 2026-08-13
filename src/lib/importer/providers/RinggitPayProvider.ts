import type { IImportProvider, ImportRow, ColumnMapping, ImportPreview, ImportValidationResult, ImportResult } from '../types';
import Papa from 'papaparse';
import { supabase } from '../../supabase';

/**
 * RinggitPay Provider extends generic concepts but is opinionated
 * on specific column structures and validation for RinggitPay settlements.
 */
export class RinggitPayProvider implements IImportProvider {
  name = 'RinggitPay';

  async preview(file: File): Promise<ImportPreview> {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        preview: 5,
        complete: (results) => {
          resolve({
            headers: results.meta.fields || [],
            sampleRows: results.data as ImportRow[]
          });
        },
        error: (error: any) => reject(error)
      });
    });
  }

  async validate(data: ImportRow[], _mapping: ColumnMapping[]): Promise<ImportValidationResult> {
    const errors: string[] = [];
    
    // RinggitPay specific validations
    const requiredRinggitPayFields = ['Transaction ID', 'Status', 'Settlement Amount'];
    const missing = requiredRinggitPayFields.filter(field => !Object.keys(data[0] || {}).includes(field));
    
    if (missing.length > 0) {
      errors.push(`Invalid RinggitPay format. Missing columns: ${missing.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: [],
      totalRows: data.length
    };
  }

  mapColumns(data: ImportRow[], _mapping: ColumnMapping[]): ImportRow[] {
    return data.map(row => {
      return {
        amount: parseFloat(row['Settlement Amount']),
        reference_number: row['Transaction ID'],
        payment_date: row['Date'] || new Date().toISOString().split('T')[0],
        status: row['Status'] === 'Success' ? 'Paid' : 'Pending',
        payment_method: 'RinggitPay',
        month: new Date(row['Date']).toLocaleString('default', { month: 'long' }),
        year: new Date(row['Date']).getFullYear(),
      };
    });
  }

  async detectDuplicates(mappedData: ImportRow[], businessId: string): Promise<ImportRow[]> {
    const refs = mappedData.map(r => r.reference_number).filter(Boolean);
    if (refs.length === 0) return [];

    const { data } = await supabase.from('payments')
      .select('reference_number')
      .eq('business_id', businessId)
      .in('reference_number', refs);

    if (!data) return [];
    
    const existingRefs = data.map(d => d.reference_number);
    return mappedData.filter(r => existingRefs.includes(r.reference_number));
  }

  async import(mappedData: ImportRow[], businessId: string, userId: string): Promise<ImportResult> {
    try {
      const { data: history } = await supabase.from('import_history').insert({
        business_id: businessId,
        user_id: userId,
        provider: this.name,
        file_name: 'ringgitpay_settlement.csv',
        status: 'Processing'
      }).select().single();

      if (!history) throw new Error('Failed to create history record');

      const payload = mappedData.map(row => ({
        ...row,
        business_id: businessId,
        import_source: this.name,
        notes: `RinggitPay Import [ID: ${history.id}]`
      }));

      // Determine an unknown customer for now if not mapped
      // In production, you would match emails or let user map it.
      
      const { error } = await supabase.from('payments').insert(payload);
      
      if (error) {
        await supabase.from('import_history').update({ status: 'Failed' }).eq('id', history.id);
        return { success: false, rowsImported: 0, rowsFailed: payload.length, errors: [error.message] };
      }

      await supabase.from('import_history').update({ 
        status: 'Completed',
        rows_imported: payload.length 
      }).eq('id', history.id);

      return {
        success: true,
        rowsImported: payload.length,
        rowsFailed: 0,
        errors: [],
        importHistoryId: history.id
      };
    } catch (e: any) {
      return { success: false, rowsImported: 0, rowsFailed: mappedData.length, errors: [e.message] };
    }
  }

  async rollback(importHistoryId: string, businessId: string): Promise<boolean> {
    const { error } = await supabase.from('payments')
      .delete()
      .eq('business_id', businessId)
      .like('notes', `%${importHistoryId}%`);

    if (!error) {
      await supabase.from('import_history').update({ status: 'Rolled Back' }).eq('id', importHistoryId);
      return true;
    }
    return false;
  }
}
