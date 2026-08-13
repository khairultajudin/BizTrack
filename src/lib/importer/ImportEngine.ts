import type { IImportProvider, ImportRow, ColumnMapping, ImportPreview, ImportValidationResult, ImportResult } from './types';

export class ImportEngine {
  private provider: IImportProvider;

  constructor(provider: IImportProvider) {
    this.provider = provider;
  }

  getProviderName(): string {
    return this.provider.name;
  }

  async generatePreview(file: File): Promise<ImportPreview> {
    return this.provider.preview(file);
  }

  async validateData(data: ImportRow[], mapping: ColumnMapping[]): Promise<ImportValidationResult> {
    return this.provider.validate(data, mapping);
  }

  mapData(data: ImportRow[], mapping: ColumnMapping[]): ImportRow[] {
    return this.provider.mapColumns(data, mapping);
  }

  async checkDuplicates(mappedData: ImportRow[], businessId: string): Promise<ImportRow[]> {
    return this.provider.detectDuplicates(mappedData, businessId);
  }

  async executeImport(mappedData: ImportRow[], businessId: string, userId: string): Promise<ImportResult> {
    return this.provider.import(mappedData, businessId, userId);
  }

  async rollbackImport(importHistoryId: string, businessId: string): Promise<boolean> {
    return this.provider.rollback(importHistoryId, businessId);
  }
}
