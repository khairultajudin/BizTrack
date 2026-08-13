import { BaseRepository } from '../../../core/database/BaseRepository';

export interface StaffEntity {
  id: string;
  name: string;
  role: string;
  phone: string;
  salary_type: string;
  salary_amount: number;
  status: string;
  business_id: string;
  created_at: string;
  deleted_at?: string;
  deleted_by?: string;
}

export class StaffRepository extends BaseRepository<StaffEntity> {
  protected readonly tableName = 'staff';
}
