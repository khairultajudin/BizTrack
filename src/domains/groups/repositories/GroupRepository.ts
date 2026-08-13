import { BaseRepository, RepositoryOptions } from '../../../core/database/BaseRepository';

export interface GroupEntity {
  id: string;
  name: string;
  teacher_id: string;
  monthly_fee: number;
  max_students: number;
  status: string;
  description: string;
  business_id: string;
  created_at: string;
  deleted_at?: string;
  deleted_by?: string;
}

export class GroupRepository extends BaseRepository<GroupEntity> {
  protected readonly tableName = 'groups';

  /**
   * Overriding list to include joins for the UI if necessary.
   */
  async listWithTeacher(options: RepositoryOptions): Promise<any[]> {
    const { data, error } = await this.baseQuery(options)
      .select('*, staff(name)')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    return data;
  }
}
