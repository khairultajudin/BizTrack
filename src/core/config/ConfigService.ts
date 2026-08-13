import { supabase } from '../../lib/supabase';
import { LoggerService } from '../logging/LoggerService';

export interface AppConfiguration {
  defaultCurrency: string;
  dateFormat: string;
  timeZone: string;
  theme: 'light' | 'dark' | 'system';
  businessTemplate: string;
}

export class ConfigService {
  private static configCache: AppConfiguration | null = null;

  static async load(businessId: string): Promise<AppConfiguration> {
    if (this.configCache) return this.configCache;

    try {
      // In production, this would read from a dedicated `configurations` table
      // or from the `businesses.settings` JSONB column.
      const { data, error } = await supabase
        .from('businesses')
        .select('settings')
        .eq('id', businessId)
        .single();

      if (error) throw error;

      this.configCache = {
        defaultCurrency: data?.settings?.default_currency || 'RM',
        dateFormat: data?.settings?.date_format || 'YYYY-MM-DD',
        timeZone: data?.settings?.timezone || 'Asia/Kuala_Lumpur',
        theme: data?.settings?.theme || 'light',
        businessTemplate: data?.settings?.template || 'Tuition Center'
      };

      return this.configCache;
    } catch (error) {
      LoggerService.error('Failed to load configuration', error);
      // Fallback
      return {
        defaultCurrency: 'RM',
        dateFormat: 'YYYY-MM-DD',
        timeZone: 'Asia/Kuala_Lumpur',
        theme: 'light',
        businessTemplate: 'Tuition Center'
      };
    }
  }

  static get(): AppConfiguration {
    if (!this.configCache) {
      throw new Error('ConfigService must be initialized via load() before get() is called.');
    }
    return this.configCache;
  }
}
