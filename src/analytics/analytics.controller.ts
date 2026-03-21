import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  async getDashboardOverview(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.analyticsService.getDashboardOverview(
      startDate,
      endDate,
      month,
      year,
    );
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

  @Get('expiring-in-7-days')
  async getMembersExpiringIn7Days() {
    return this.analyticsService.getMembersExpiringIn7Days();
  }

  @Get('payment-updates')
  async getPaymentUpdates() {
    return this.analyticsService.getPaymentUpdates(20);
  }
}
