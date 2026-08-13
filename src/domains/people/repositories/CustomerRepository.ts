import { BaseRepository, RepositoryOptions } from '../../../core/database/BaseRepository';

export interface CustomerEntity {
  id: string;
  name: string;
  parent_name: string;
  phone: string;
  email: string;
  assigned_group_id: string;
  status: string;
  business_id: string;
  created_at: string;
  deleted_at?: string;
  deleted_by?: string;
}

export class CustomerRepository extends BaseRepository<CustomerEntity> {
  protected readonly tableName = 'customers';

  /**
   * Overriding list to include joins for the UI if necessary,
   * though strictly speaking joins might be handled in a specialized query or GraphQL.
   */
  async listWithGroup(options: RepositoryOptions): Promise<any[]> {
    const { data, error } = await this.baseQuery(options)
      .select('*, groups(name)')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    return data;
  }
}
