import type { IImportProvider, ImportRow, ColumnMapping, ImportPreview, ImportValidationResult, ImportResult } from '../types';
import Papa from 'papaparse';
import { supabase } from '../../supabase';

export class CsvProvider implements IImportProvider {
  name = 'Generic CSV';

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

  async validate(data: ImportRow[], mapping: ColumnMapping[]): Promise<ImportValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!mapping.some(m => m.targetColumn === 'amount')) {
      errors.push('Target column "amount" is required for financial imports.');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      totalRows: data.length
    };
  }

  mapColumns(data: ImportRow[], mapping: ColumnMapping[]): ImportRow[] {
    return data.map(row => {
      const mappedRow: ImportRow = {};
      mapping.forEach(m => {
        if (row[m.sourceColumn] !== undefined) {
          mappedRow[m.targetColumn] = row[m.sourceColumn];
        }
      });
      return mappedRow;
    });
  }

  async detectDuplicates(_mappedData: ImportRow[], _businessId: string): Promise<ImportRow[]> {
    // Basic duplicate detection logic can go here.
    // For a generic CSV, we might skip or rely on constraints.
    return [];
  }

  async import(mappedData: ImportRow[], businessId: string, userId: string): Promise<ImportResult> {
    try {
      // 1. Create history record
      const { data: history, error: historyError } = await supabase.from('import_history').insert({
        business_id: businessId,
        user_id: userId,
        provider: this.name,
        file_name: 'generic_import.csv',
        status: 'Processing'
      }).select().single();

      if (historyError) throw historyError;

      // 2. Format payload
      const payload = mappedData.map(row => ({
        ...row,
        business_id: businessId,
        import_source: this.name,
        notes: `Imported via CSV [ID: ${history.id}]`
      }));

      // Assume we are importing into payments for now based on generic mapping
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
    // Delete any payment containing the history ID in notes
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
