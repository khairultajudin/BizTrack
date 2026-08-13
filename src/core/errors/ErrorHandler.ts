import { LoggerService } from '../logging/LoggerService';

export type ErrorType = 'VALIDATION' | 'DATABASE' | 'NETWORK' | 'AUTH' | 'UNKNOWN';

export class AppError extends Error {
  public type: ErrorType;
  public context?: any;
  constructor(message: string, type: ErrorType, context?: any) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.context = context;
  }
}

/**
 * Global Error Handler.
 * Intercepts, formats, and logs errors across the application.
 */
export class ErrorHandler {
  static handle(error: any): AppError {
    LoggerService.error('Intercepted Error', error);

    if (error instanceof AppError) {
      return error;
    }

    if (error.message?.includes('Validation')) {
      return new AppError(error.message, 'VALIDATION');
    }

    if (error.code && error.code.startsWith('PGRST')) {
      // PostgREST Database Error
      return new AppError(`Database Error: ${error.message}`, 'DATABASE', error);
    }

    if (error.status === 401 || error.status === 403) {
      return new AppError('Authentication Error', 'AUTH', error);
    }

    return new AppError(error.message || 'An unexpected error occurred.', 'UNKNOWN', error);
  }
}
