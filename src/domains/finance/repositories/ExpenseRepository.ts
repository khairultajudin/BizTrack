import { BaseRepository } from '../../../core/database/BaseRepository';

export interface ExpenseEntity {
  id: string;
  amount: number;
  category: string;
  date: string;
  description: string;
  business_id: string;
  created_at: string;
  deleted_at?: string;
  deleted_by?: string;
}

export class ExpenseRepository extends BaseRepository<ExpenseEntity> {
  protected readonly tableName = 'expenses';
}
