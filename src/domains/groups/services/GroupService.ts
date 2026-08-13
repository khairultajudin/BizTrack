import { GroupRepository, GroupEntity } from '../repositories/GroupRepository';
import { LoggerService } from '../../../core/logging/LoggerService';
import { AppValidator } from '../../../core/validation/AppValidator';
import { z } from 'zod';

const groupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  teacher_id: z.string().uuid('Invalid teacher assignment').optional(),
  monthly_fee: z.number().min(0, 'Fee cannot be negative'),
  max_students: z.number().min(1, 'Max students must be at least 1'),
  status: z.enum(['Active', 'Inactive']),
  description: z.string().optional(),
});

export class GroupService {
  private groupRepo = new GroupRepository();

  async listClasses(businessId: string) {
    return this.groupRepo.listWithTeacher({ businessId });
  }

  async createClass(businessId: string, data: any): Promise<GroupEntity> {
    const validatedData = AppValidator.validate(groupSchema, data);
    LoggerService.info(`Creating class for business ${businessId}`, { name: validatedData.name });
    return this.groupRepo.create(validatedData, { businessId });
  }

  async updateClass(businessId: string, id: string, data: any): Promise<GroupEntity> {
    const validatedData = AppValidator.validate(groupSchema, data);
    LoggerService.info(`Updating class ${id} for business ${businessId}`);
    return this.groupRepo.update(id, validatedData, { businessId });
  }

  async deleteClass(businessId: string, id: string, userId: string): Promise<void> {
    LoggerService.warn(`User ${userId} soft-deleting class ${id}`);
    return this.groupRepo.softDelete(id, userId, { businessId });
  }
}
