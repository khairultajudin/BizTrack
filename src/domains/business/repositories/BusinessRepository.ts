import { supabase } from '../../../lib/supabase';
import { BaseRepository, RepositoryOptions } from '../../../core/database/BaseRepository';

export interface BusinessEntity {
  id: string;
  name: string;
  creator_id: string;
  created_at: string;
}

export class BusinessRepository extends BaseRepository<BusinessEntity> {
  protected readonly tableName = 'businesses';

  /**
   * Overridden baseQuery because businesses table doesn't have a business_id column (it is the business).
   * Soft deletes are currently not supported on the business root table to prevent catastrophic data loss.
   */
  protected baseQuery() {
    return supabase.from(this.tableName).select('*');
  }

  async findByCreator(creatorId: string): Promise<BusinessEntity[]> {
    const { data, error } = await this.baseQuery().eq('creator_id', creatorId);
    if (error) throw error;
    return data as BusinessEntity[];
  }
}
