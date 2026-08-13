export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  timestamp: string;
}

/**
 * Core LoggerService
 * Replaces console.log calls.
 * Built to be easily swapped with DataDog, Sentry, or CloudWatch in the future.
 */
export class LoggerService {
  private static format(level: LogLevel, message: string, context?: Record<string, any>): LogEntry {
    return {
      level,
      message,
      context,
      timestamp: new Date().toISOString(),
    };
  }

  private static output(entry: LogEntry) {
    // In production, this might send to an external observability platform.
    const outputString = `[${entry.timestamp}] [${entry.level}] ${entry.message}`;
    
    switch (entry.level) {
      case 'DEBUG':
        console.debug(outputString, entry.context || '');
        break;
      case 'INFO':
        console.info(outputString, entry.context || '');
        break;
      case 'WARN':
        console.warn(outputString, entry.context || '');
        break;
      case 'ERROR':
      case 'CRITICAL':
        console.error(outputString, entry.context || '');
        break;
    }
  }

  static debug(message: string, context?: Record<string, any>) {
    this.output(this.format('DEBUG', message, context));
  }

  static info(message: string, context?: Record<string, any>) {
    this.output(this.format('INFO', message, context));
  }

  static warn(message: string, context?: Record<string, any>) {
    this.output(this.format('WARN', message, context));
  }

  static error(message: string, error?: any, context?: Record<string, any>) {
    this.output(this.format('ERROR', message, { error, ...context }));
  }

  static critical(message: string, error?: any, context?: Record<string, any>) {
    this.output(this.format('CRITICAL', message, { error, ...context }));
  }
}
