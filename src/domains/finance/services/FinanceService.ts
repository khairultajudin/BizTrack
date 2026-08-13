import { PaymentRepository, PaymentEntity } from '../repositories/PaymentRepository';
import { ExpenseRepository, ExpenseEntity } from '../repositories/ExpenseRepository';
import { LoggerService } from '../../../core/logging/LoggerService';
import { EventBus, ApplicationEvents } from '../../../core/events/EventBus';
import { AppValidator } from '../../../core/validation/AppValidator';
import { z } from 'zod';

const paymentSchema = z.object({
  customer_id: z.string().uuid('Invalid customer'),
  amount: z.number().min(0.01, 'Amount must be greater than 0'),
  payment_date: z.string(),
  month: z.string(),
  year: z.string(),
  payment_method: z.enum(['Cash', 'Bank Transfer', 'Credit Card', 'RinggitPay', 'Other']),
  status: z.enum(['Paid', 'Pending', 'Overdue']),
  reference_number: z.string().optional(),
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
