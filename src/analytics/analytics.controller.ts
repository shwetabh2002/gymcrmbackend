import { Controller, Get, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { LocationScope } from '../common/tenant/location.decorator';

@Controller('analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @RequirePermissions(Permission.DASHBOARD)
  async getDashboardOverview(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
  ) {
    return this.analyticsService.getDashboardOverview(companyId, locScope);
  }

  @Get('members')
  @RequirePermissions(Permission.DASHBOARD, Permission.MEMBERS_VIEW)
  async getMemberStatistics(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
  ) {
    return this.analyticsService.getMemberStatistics(companyId, locScope);
  }

  @Get('revenue')
  @RequirePermissions(Permission.PAYMENTS_VIEW, Permission.DASHBOARD)
  async getRevenueAnalytics(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
  ) {
    return this.analyticsService.getRevenueAnalytics(companyId, locScope);
  }

  @Get('subscriptions')
  @RequirePermissions(Permission.DASHBOARD, Permission.SUBSCRIPTIONS_VIEW)
  async getSubscriptionAnalytics(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
  ) {
    return this.analyticsService.getSubscriptionAnalytics(companyId, locScope);
  }

  @Get('payment-trends')
  @RequirePermissions(Permission.PAYMENTS_VIEW, Permission.DASHBOARD)
  async getPaymentTrends(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
  ) {
    return this.analyticsService.getPaymentTrends(companyId, locScope);
  }
}
