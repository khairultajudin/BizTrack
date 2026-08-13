import { CustomerRepository, CustomerEntity } from '../repositories/CustomerRepository';
import { StaffRepository, StaffEntity } from '../repositories/StaffRepository';
import { LoggerService } from '../../../core/logging/LoggerService';
import { AppValidator } from '../../../core/validation/AppValidator';
import { z } from 'zod';

const customerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  parent_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  assigned_group_id: z.string().uuid('Invalid class assignment').optional(),
  status: z.enum(['Active', 'Inactive']),
});

const staffSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.string().min(1, 'Role is required'),
  phone: z.string().optional(),
  salary_type: z.enum(['Monthly', 'Hourly', 'Percentage']),
  salary_amount: z.number().min(0, 'Salary cannot be negative'),
  status: z.enum(['Active', 'Inactive']),
});

export class PeopleService {
  private customerRepo = new CustomerRepository();
  private staffRepo = new StaffRepository();

  // --- Customers ---

  async listStudents(businessId: string) {
    return this.customerRepo.listWithGroup({ businessId });
  }

  async createStudent(businessId: string, data: any): Promise<CustomerEntity> {
    const validatedData = AppValidator.validate(customerSchema, data);
    LoggerService.info(`Creating student for business ${businessId}`, { name: validatedData.name });
    return this.customerRepo.create(validatedData, { businessId });
  }

  async updateStudent(businessId: string, id: string, data: any): Promise<CustomerEntity> {
    const validatedData = AppValidator.validate(customerSchema, data);
    LoggerService.info(`Updating student ${id} for business ${businessId}`);
    return this.customerRepo.update(id, validatedData, { businessId });
  }

  async deleteStudent(businessId: string, id: string, userId: string): Promise<void> {
    LoggerService.warn(`User ${userId} soft-deleting student ${id}`);
    return this.customerRepo.softDelete(id, userId, { businessId });
  }

  // --- Staff ---

  async listStaff(businessId: string) {
    return this.staffRepo.list({ businessId });
  }

  async createStaff(businessId: string, data: any): Promise<StaffEntity> {
    const validatedData = AppValidator.validate(staffSchema, data);
    LoggerService.info(`Creating staff for business ${businessId}`, { name: validatedData.name });
    return this.staffRepo.create(validatedData, { businessId });
  }

  async updateStaff(businessId: string, id: string, data: any): Promise<StaffEntity> {
    const validatedData = AppValidator.validate(staffSchema, data);
    LoggerService.info(`Updating staff ${id} for business ${businessId}`);
    return this.staffRepo.update(id, validatedData, { businessId });
  }

  async deleteStaff(businessId: string, id: string, userId: string): Promise<void> {
    LoggerService.warn(`User ${userId} soft-deleting staff ${id}`);
    return this.staffRepo.softDelete(id, userId, { businessId });
  }
}
