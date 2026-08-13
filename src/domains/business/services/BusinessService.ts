import { BusinessRepository } from '../repositories/BusinessRepository';
import { LoggerService } from '../../../core/logging/LoggerService';

export class BusinessService {
  private repo = new BusinessRepository();

  async getBusinessProfile(businessId: string) {
    try {
      // Intentionally passing empty options since BusinessRepository overrides baseQuery
      const business = await this.repo.findById(businessId, { businessId: '' });
      return business;
    } catch (error: any) {
      LoggerService.error(`Failed to fetch business profile for ${businessId}`, error);
      throw error;
    }
  }
}
