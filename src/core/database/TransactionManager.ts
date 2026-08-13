import { LoggerService } from '../logging/LoggerService';

/**
 * TransactionManager
 * Supabase/PostgREST does not natively support multi-statement transactions out-of-the-box via the REST API
 * (unless using RPC functions). This class serves as a conceptual abstraction to orchestrate
 * pseudo-transactions, providing a rollback mechanism for compound API calls.
 */
export class TransactionManager {
  /**
   * Executes an array of asynchronous operations.
   * If any operation fails, it currently stops execution and throws.
   * Future implementation can track successful operations and implement manual compensation/rollback logic.
   */
  static async run<T>(operations: (() => Promise<any>)[]): Promise<T[]> {
    const results: T[] = [];
    
    for (let i = 0; i < operations.length; i++) {
      try {
        const res = await operations[i]();
        results.push(res);
      } catch (error: any) {
        LoggerService.error(`Transaction failed at operation index ${i}`, error);
        // Note: Real rollback logic goes here if applicable via compensation actions.
        throw new Error(`Transaction aborted: ${error.message}`);
      }
    }
    
    return results;
  }
}
