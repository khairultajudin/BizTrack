import { PaymentRepository, PaymentEntity } from '../repositories/PaymentRepository';
import { ExpenseRepository, ExpenseEntity } from '../repositories/ExpenseRepository';
import { LoggerService } from '../../../core/logging/LoggerService';
import { EventBus, ApplicationEvents } from '../../../core/events/EventBus';
import { AppValidator } from '../../../core/validation/AppValidator';
import { StorageService } from '../../../services/StorageService';
import { z } from 'zod';

const paymentSchema = z.object({
  customer_id: z.string().uuid('Invalid customer'),
  amount: z.number().min(0.01, 'Amount must be greater than 0'),
  payment_date: z.string(),
  month: z.string(),
  year: z.union([z.string(), z.number()]),
  payment_method: z.enum(['Cash', 'Bank Transfer', 'Credit Card', 'Online', 'RinggitPay', 'Other']),
  status: z.enum(['Paid', 'Pending', 'Cancelled', 'Overdue']),
  reference_number: z.string().nullable().optional(),
  invoice_path: z.string().nullable().optional(),
});

const expenseSchema = z.object({
  amount: z.number().min(0.01, 'Amount must be greater than 0'),
  category: z.string(),
  date: z.string(),
  description: z.string().optional(),
});

export class FinanceService {
  private paymentRepo = new PaymentRepository();
  private expenseRepo = new ExpenseRepository();

  // --- Payments ---

  async listPayments(businessId: string) {
    return this.paymentRepo.listWithCustomer({ businessId });
  }

  async createPayment(businessId: string, data: any): Promise<PaymentEntity> {
    const validatedData = AppValidator.validate(paymentSchema, data);
    LoggerService.info(`Creating payment for business ${businessId}`);
    const result = await this.paymentRepo.create(validatedData, { businessId });
    EventBus.emit(ApplicationEvents.PAYMENT_CREATED, result);
    return result;
  }

  async updatePayment(businessId: string, id: string, data: any): Promise<PaymentEntity> {
    const validatedData = AppValidator.validate(paymentSchema, data);
    LoggerService.info(`Updating payment ${id} for business ${businessId}`);
    return this.paymentRepo.update(id, validatedData, { businessId });
  }

  async deletePayment(businessId: string, id: string, userId: string): Promise<void> {
    LoggerService.warn(`User ${userId} soft-deleting payment ${id}`);
    return this.paymentRepo.softDelete(id, userId, { businessId });
  }

  /**
   * Uploads an invoice PDF to private storage and associates it with an existing payment record.
   * Does not modify payment amount or payment status.
   * Rolls back the uploaded storage object if the database update fails.
   */
  async attachInvoiceToPayment(
    businessId: string,
    paymentId: string,
    file: File,
    metadata?: { reference_number?: string | null; payment_date?: string }
  ): Promise<PaymentEntity> {
    const existing = await this.paymentRepo.findById(paymentId, { businessId });
    if (!existing) {
      throw new Error('Payment record not found in your business.');
    }

    const uploadedPath = await StorageService.uploadInvoice(businessId, paymentId, file);

    try {
      const updatePayload: Partial<PaymentEntity> = {
        invoice_path: uploadedPath,
      };
      if (metadata?.reference_number !== undefined) {
        updatePayload.reference_number = metadata.reference_number;
      }
      if (metadata?.payment_date !== undefined) {
        updatePayload.payment_date = metadata.payment_date;
      }

      const updated = await this.paymentRepo.update(paymentId, updatePayload, { businessId });

      // Clean up replaced invoice file if one existed previously
      if (existing.invoice_path && existing.invoice_path !== uploadedPath) {
        try {
          await StorageService.deleteInvoice(businessId, existing.invoice_path, paymentId);
        } catch (_cleanupErr) {
          LoggerService.warn(`Failed to clean up replaced invoice file ${existing.invoice_path}`);
        }
      }

      return updated;
    } catch (dbErr) {
      // Roll back uploaded file to prevent orphaned storage objects
      try {
        await StorageService.deleteInvoice(businessId, uploadedPath, paymentId);
      } catch (rollbackErr) {
        LoggerService.error(`Failed to roll back orphaned invoice file ${uploadedPath}`, rollbackErr);
      }
      throw dbErr;
    }
  }

  /**
   * Removes an invoice attachment from a payment record and deletes the PDF from private storage.
   */
  async removeInvoiceFromPayment(businessId: string, paymentId: string): Promise<PaymentEntity> {
    const existing = await this.paymentRepo.findById(paymentId, { businessId });
    if (!existing) {
      throw new Error('Payment record not found in your business.');
    }

    const previousPath = existing.invoice_path;
    const updated = await this.paymentRepo.update(paymentId, { invoice_path: null }, { businessId });

    if (previousPath) {
      await StorageService.deleteInvoice(businessId, previousPath, paymentId);
    }

    return updated;
  }

  async getInvoiceSignedUrl(
    businessId: string,
    invoicePath: string,
    expectedPaymentId?: string
  ): Promise<string> {
    return StorageService.getInvoiceSignedUrl(
      businessId,
      invoicePath,
      StorageService.SIGNED_URL_EXPIRY_SECONDS,
      expectedPaymentId
    );
  }

  // --- Expenses ---

  async listExpenses(businessId: string) {
    return this.expenseRepo.list({ businessId });
  }

  async createExpense(businessId: string, data: any): Promise<ExpenseEntity> {
    const validatedData = AppValidator.validate(expenseSchema, data);
    LoggerService.info(`Creating expense for business ${businessId}`);
    const result = await this.expenseRepo.create(validatedData, { businessId });
    EventBus.emit(ApplicationEvents.EXPENSE_CREATED, result);
    return result;
  }

  async updateExpense(businessId: string, id: string, data: any): Promise<ExpenseEntity> {
    const validatedData = AppValidator.validate(expenseSchema, data);
    LoggerService.info(`Updating expense ${id} for business ${businessId}`);
    return this.expenseRepo.update(id, validatedData, { businessId });
  }

  async deleteExpense(businessId: string, id: string, userId: string): Promise<void> {
    LoggerService.warn(`User ${userId} soft-deleting expense ${id}`);
    return this.expenseRepo.softDelete(id, userId, { businessId });
  }
}
