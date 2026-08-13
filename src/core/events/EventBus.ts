import { LoggerService } from '../logging/LoggerService';

type EventCallback = (payload: any) => void;

/**
 * Core EventBus
 * Enables loosely coupled, event-driven architecture within the frontend.
 */
export class EventBus {
  private static events: Record<string, EventCallback[]> = {};

  /**
   * Subscribe to an event
   */
  static on(event: string, callback: EventCallback): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
    LoggerService.debug(`Subscribed to event: ${event}`);
  }

  /**
   * Unsubscribe from an event
   */
  static off(event: string, callback: EventCallback): void {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(cb => cb !== callback);
  }

  /**
   * Publish an event
   */
  static emit(event: string, payload?: any): void {
    LoggerService.debug(`Emitting event: ${event}`, { payload });
    if (!this.events[event]) return;
    
    this.events[event].forEach(callback => {
      try {
        callback(payload);
      } catch (error) {
        LoggerService.error(`Error in event listener for ${event}`, error);
      }
    });
  }
}

// Pre-defined standard events
export const ApplicationEvents = {
  PAYMENT_CREATED: 'payment:created',
  EXPENSE_CREATED: 'expense:created',
  IMPORT_COMPLETED: 'import:completed',
  BUSINESS_UPDATED: 'business:updated',
  DASHBOARD_LAYOUT_CHANGED: 'dashboard:layout_changed',
  USER_LOGIN: 'user:login',
  USER_LOGOUT: 'user:logout',
};
