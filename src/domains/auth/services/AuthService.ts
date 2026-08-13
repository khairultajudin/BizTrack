import { supabase } from '../../../lib/supabase';
import { LoggerService } from '../../../core/logging/LoggerService';
import { EventBus, ApplicationEvents } from '../../../core/events/EventBus';

export class AuthService {
  /**
   * Complete standard login flow.
   * Fires global event for audit logging upon success.
   */
  static async login(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) throw error;
      
      if (data.user) {
        EventBus.emit(ApplicationEvents.USER_LOGIN, { userId: data.user.id });
        LoggerService.info(`User logged in: ${data.user.id}`);
      }
      
      return data;
    } catch (error: any) {
      LoggerService.warn(`Login failed for ${email}`, error);
      throw error;
    }
  }

  static async logout() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        EventBus.emit(ApplicationEvents.USER_LOGOUT, { userId: user.id });
      }
      
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      LoggerService.info('User logged out');
    } catch (error: any) {
      LoggerService.error('Logout failed', error);
      throw error;
    }
  }
}
