import { Controller, Get, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  async getDashboardOverview() {
    return this.analyticsService.getDashboardOverview();
  }

  @Get('members')
  async getMemberStatistics() {
    return this.analyticsService.getMemberStatistics();
  }

  @Get('revenue')
  async getRevenueAnalytics() {
    return this.analyticsService.getRevenueAnalytics();
  }

  @Get('subscriptions')
  async getSubscriptionAnalytics() {
    return this.analyticsService.getSubscriptionAnalytics();
  }

  @Get('payment-trends')
  async getPaymentTrends() {
    return this.analyticsService.getPaymentTrends();
  }
}
