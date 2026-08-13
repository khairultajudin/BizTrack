import { supabase } from '../../lib/supabase';
import { LoggerService } from '../logging/LoggerService';

export interface RepositoryOptions {
  businessId: string;
}

export interface PaginationOptions {
  page: number;
  pageSize: number;
}

/**
 * BaseRepository
 * Enforces the strict rule: No UI components touch the Supabase client directly.
 */
export abstract class BaseRepository<T> {
  protected abstract readonly tableName: string;

  /**
   * Internal helper to apply common RLS and soft-delete filters
   */
  protected baseQuery(options: RepositoryOptions, includeDeleted = false) {
    let query = supabase.from(this.tableName).select('*').eq('business_id', options.businessId);
    if (!includeDeleted) {
      query = query.is('deleted_at', null);
    }
    return query;
  }

  async findById(id: string, options: RepositoryOptions): Promise<T | null> {
    try {
      const { data, error } = await this.baseQuery(options).eq('id', id).maybeSingle();
      if (error) throw error;
      return data as T;
    } catch (error: any) {
      LoggerService.error(`Repository findById failed for ${this.tableName}`, error);
      throw error;
    }
  }

  async list(options: RepositoryOptions): Promise<T[]> {
    try {
      const { data, error } = await this.baseQuery(options).order('created_at', { ascending: false });
      if (error) throw error;
      return data as T[];
    } catch (error: any) {
      LoggerService.error(`Repository list failed for ${this.tableName}`, error);
      throw error;
    }
  }

  async paginate(options: RepositoryOptions, pagination: PaginationOptions): Promise<{ data: T[], count: number }> {
    try {
      const from = (pagination.page - 1) * pagination.pageSize;
      const to = from + pagination.pageSize - 1;

      const { data, error, count } = await supabase
        .from(this.tableName)
        .select('*', { count: 'exact' })
        .eq('business_id', options.businessId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return { data: data as T[], count: count || 0 };
    } catch (error: any) {
      LoggerService.error(`Repository paginate failed for ${this.tableName}`, error);
      throw error;
    }
  }

  async create(data: Partial<T>, options: RepositoryOptions): Promise<T> {
    try {
      const payload = { ...data, business_id: options.businessId };
      const { data: result, error } = await supabase.from(this.tableName).insert(payload).select().single();
      if (error) throw error;
      return result as T;
    } catch (error: any) {
      LoggerService.error(`Repository create failed for ${this.tableName}`, error);
      throw error;
    }
  }

  async update(id: string, data: Partial<T>, options: RepositoryOptions): Promise<T> {
    try {
      const { data: result, error } = await supabase
        .from(this.tableName)
        .update(data as any)
        .eq('id', id)
        .eq('business_id', options.businessId)
        .select()
        .single();
        
      if (error) throw error;
      return result as T;
    } catch (error: any) {
      LoggerService.error(`Repository update failed for ${this.tableName}`, error);
      throw error;
    }
  }

  async softDelete(id: string, userId: string, options: RepositoryOptions): Promise<void> {
    try {
      const { error } = await supabase
        .from(this.tableName)
        .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
        .eq('id', id)
        .eq('business_id', options.businessId);
        
      if (error) throw error;
    } catch (error: any) {
      LoggerService.error(`Repository softDelete failed for ${this.tableName}`, error);
      throw error;
    }
  }

  async restore(id: string, options: RepositoryOptions): Promise<void> {
    try {
      const { error } = await supabase
        .from(this.tableName)
        .update({ deleted_at: null, deleted_by: null })
        .eq('id', id)
        .eq('business_id', options.businessId);
        
      if (error) throw error;
    } catch (error: any) {
      LoggerService.error(`Repository restore failed for ${this.tableName}`, error);
      throw error;
    }
  }
}
