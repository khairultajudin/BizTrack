import { BaseRepository, RepositoryOptions } from '../../../core/database/BaseRepository';

export interface PaymentEntity {
  id: string;
  customer_id: string;
  amount: number;
  payment_date: string;
  month: string;
  year: string;
  payment_method: string;
  status: string;
  reference_number: string;
  business_id: string;
  created_at: string;
  deleted_at?: string;
  deleted_by?: string;
}

export class PaymentRepository extends BaseRepository<PaymentEntity> {
  protected readonly tableName = 'payments';

  /**
   * Overriding list to include joins for the UI if necessary.
   */
  async listWithCustomer(options: RepositoryOptions): Promise<any[]> {
    const { data, error } = await this.baseQuery(options)
      .select('*, customers(name)')
      .order('payment_date', { ascending: false });
      
    if (error) throw error;
    return data;
  }
}
