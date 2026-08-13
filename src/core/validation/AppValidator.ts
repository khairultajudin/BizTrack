import { z } from 'zod';

export class AppValidator {
  /**
   * Reusable schema validation execution.
   * Throws standardized AppError if validation fails.
   */
  static validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = (result.error as any).errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ');
      // Throw raw error for now. ErrorHandler will intercept it.
      throw new Error(`Validation Error: ${errors}`);
    }
    return result.data;
  }
}
