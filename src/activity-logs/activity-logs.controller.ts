import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ActivityLogsService } from './activity-logs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { SubscriptionGuard } from '../platform-billing/guards/subscription.guard';
import { BillingExempt } from '../platform-billing/decorators/billing.decorators';

/** Gym-scoped activity feed — paid + time-retained audit trail. */
@Controller('activity-logs')
@UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
@BillingExempt()
export class ActivityLogsController {
  constructor(private readonly activityLogs: ActivityLogsService) {}

  @Get()
  @RequirePermissions(Permission.SETTINGS_VIEW, Permission.DASHBOARD)
  @HttpCode(HttpStatus.OK)
  list(
    @CompanyId() companyId: string,
    @Query('q') q?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    return this.activityLogs.listForCompany({
      companyId,
      q,
      action,
      limit: limit ? Number(limit) : 50,
      skip: skip ? Number(skip) : 0,
    });
  }

  @Get('status')
  @RequirePermissions(Permission.SETTINGS_VIEW, Permission.DASHBOARD)
  @HttpCode(HttpStatus.OK)
  status(@CompanyId() companyId: string) {
    return this.activityLogs.getAccess(companyId);
  }
}
