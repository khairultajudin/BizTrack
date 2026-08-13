export interface ImportRow {
  [key: string]: any;
}

export interface ImportValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  totalRows: number;
}

export interface ColumnMapping {
  sourceColumn: string;
  targetColumn: string;
}

export interface ImportPreview {
  headers: string[];
  sampleRows: ImportRow[];
}

export interface ImportResult {
  success: boolean;
  rowsImported: number;
  rowsFailed: number;
  errors: string[];
  importHistoryId?: string;
}

export interface IImportProvider {
  name: string;
  
  /**
   * Parse the raw file and return a preview of headers and data
   */
  preview(file: File): Promise<ImportPreview>;
  
  /**
   * Validate the mapped data before execution
   */
  validate(data: ImportRow[], mapping: ColumnMapping[]): Promise<ImportValidationResult>;
  
  /**
   * Map raw data using the provided mappings to standard BizTrack objects
   */
  mapColumns(data: ImportRow[], mapping: ColumnMapping[]): ImportRow[];
  
  /**
   * Detect potential duplicates against existing database records
   */
  detectDuplicates(mappedData: ImportRow[], businessId: string): Promise<ImportRow[]>;
  
  /**
   * Execute the import into Supabase
   */
  import(mappedData: ImportRow[], businessId: string, userId: string): Promise<ImportResult>;
  
  /**
   * Rollback an import using the importHistoryId
   */
  rollback(importHistoryId: string, businessId: string): Promise<boolean>;
}
