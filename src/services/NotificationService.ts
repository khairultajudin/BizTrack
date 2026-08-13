import { supabase } from '../lib/supabase';

export type NotificationType = 'success' | 'warning' | 'error' | 'info' | 'system';

export interface NotificationPayload {
  businessId: string;
  userId: string;
  title: string;
  message: string;
  type?: NotificationType;
}

export class NotificationService {
  /**
   * Send an in-app notification to a specific user.
   */
  static async send(payload: NotificationPayload) {
    const { error } = await supabase.from('notifications').insert({
      business_id: payload.businessId,
      user_id: payload.userId,
      title: payload.title,
      message: payload.message,
      type: payload.type || 'info',
      is_read: false
    });

    if (error) {
      console.error('Failed to send notification', error);
      throw error;
    }

    // Future integrations can be triggered here:
    // await this.sendEmail(payload);
    // await this.sendWhatsApp(payload);
  }

  /**
   * Log an activity to the activity log (distinct from direct notifications)
   */
  static async logActivity(businessId: string, userId: string, action: string, details: any = {}) {
    // Implement standard activity logging here
    // Example: await supabase.from('activity_logs').insert(...)
    console.log(`[ACTIVITY LOG] User ${userId} performed ${action} on business ${businessId}`, details);
  }

  static async markAsRead(notificationId: string) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId);
  }

  static async markAllAsRead(businessId: string, userId: string) {
    await supabase.from('notifications').update({ is_read: true }).eq('business_id', businessId).eq('user_id', userId);
  }
}
