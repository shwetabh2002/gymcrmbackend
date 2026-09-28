import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformChargingService } from './platform-charging.service';
import { PlatformPlansService } from './platform-plans.service';
import { PlatformBillingWorkerService } from './platform-billing-worker.service';
import { PlatformPlanInquiryService } from './platform-plan-inquiry.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { Role } from '../common/enums/role.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BillingExempt } from './decorators/billing.decorators';
import { BILLING_INTERVALS } from '../config/platform-billing.config';

class ChangePlanDto {
  @IsString()
  planCode!: string;

  @IsOptional()
  @IsIn([...BILLING_INTERVALS])
  interval?: 'MONTHLY' | 'YEARLY';
}

class CancelDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

class CustomInquiryDto {
  @IsString()
  @MaxLength(120)
  contactName!: string;

  @IsString()
  @MaxLength(40)
  contactPhone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contactEmail?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  branchCount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  approxMembers?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  needs?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentSoftware?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

class InquiryStatusDto {
  @IsIn(['NEW', 'CONTACTED', 'CLOSED'])
  status!: 'NEW' | 'CONTACTED' | 'CLOSED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNotes?: string;
}

class CreatePlatformPlanDto {
  @IsString()
  @MaxLength(40)
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerBranch!: number;

  @IsOptional()
  @IsIn([...BILLING_INTERVALS])
  interval?: 'MONTHLY' | 'YEARLY';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  trialDays?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxBranches?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxMembers?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isContactSales?: boolean;

  @IsOptional()
  @IsBoolean()
  isRecommended?: boolean;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

class ExtendTrialDto {
  /** Add this many days from max(now, current trial end). Default 7. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  days?: number;

  /** Absolute end date (ISO). Overrides days when set. */
  @IsOptional()
  @IsString()
  until?: string;
}

/**
 * A gym's own subscription screen.
 *
 * Every route here is billing-exempt: a gym whose trial lapsed must still be
 * able to see its standing and pay, otherwise the gate would lock out exactly
 * the people trying to become customers.
 */
@Controller('subscription')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@BillingExempt()
export class PlatformBillingController {
  constructor(
    private readonly billing: PlatformBillingService,
    private readonly charging: PlatformChargingService,
    private readonly plans: PlatformPlansService,
    private readonly inquiries: PlatformPlanInquiryService,
  ) {}

  /** Where this gym stands: plan, status, days left, what renewal will cost. */
  @Get()
  @RequirePermissions(
    Permission.SETTINGS_VIEW,
    Permission.SETTINGS_UPDATE,
    Permission.DASHBOARD,
  )
  @HttpCode(HttpStatus.OK)
  async mine(@CompanyId() companyId: string) {
    const snapshot = await this.billing.snapshot(companyId);
    return {
      ...snapshot,
      billingConfigured: this.charging.isConfigured(),
    };
  }

  /** The plans a gym can move to. */
  @Get('plans')
  @RequirePermissions(
    Permission.SETTINGS_VIEW,
    Permission.SETTINGS_UPDATE,
    Permission.DASHBOARD,
  )
  @HttpCode(HttpStatus.OK)
  availablePlans() {
    return this.plans.listPublic();
  }

  /** Past charges — the gym's own billing history with us. */
  @Get('invoices')
  @RequirePermissions(Permission.SETTINGS_VIEW, Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  invoices(@CompanyId() companyId: string) {
    return this.billing.charges(companyId);
  }

  @Post('plan')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  changePlan(@CompanyId() companyId: string, @Body() body: ChangePlanDto) {
    return this.billing.changePlan(
      companyId,
      body.planCode,
      body.interval || 'MONTHLY',
    );
  }

  /**
   * Custom / sales-led plan: gym answers a few questions; SUPER_ADMIN sees the
   * lead and reaches out.
   */
  @Post('custom-inquiry')
  @RequirePermissions(Permission.SETTINGS_UPDATE, Permission.SETTINGS_VIEW)
  @HttpCode(HttpStatus.CREATED)
  submitCustomInquiry(
    @CompanyId() companyId: string,
    @CurrentUser() user: { userId: string; name?: string },
    @Body() body: CustomInquiryDto,
  ) {
    return this.inquiries.submit(companyId, user.userId, body, user.name);
  }

  /**
   * Starts the UPI Autopay mandate for our fees. The returned link is what the
   * gym owner approves; the first period is charged in the same step.
   */
  @Post('mandate')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  startMandate(@CompanyId() companyId: string) {
    return this.charging.startMandate(companyId);
  }

  @Post('cancel')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  cancel(@CompanyId() companyId: string, @Body() body: CancelDto) {
    return this.billing.cancel(companyId, body.reason);
  }

  @Post('resume')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  resume(@CompanyId() companyId: string) {
    return this.billing.resume(companyId);
  }
}

/** Platform-side view: every gym's standing, revenue, and manual controls. */
@Controller('platform')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@BillingExempt()
export class PlatformAdminController {
  constructor(
    private readonly billing: PlatformBillingService,
    private readonly plans: PlatformPlansService,
    private readonly worker: PlatformBillingWorkerService,
    private readonly inquiries: PlatformPlanInquiryService,
    private readonly activityLogs: ActivityLogsService,
  ) {}

  /** Counts by status, MRR, lifetime revenue, trials ending soon. */
  @Get('overview')
  @HttpCode(HttpStatus.OK)
  overview() {
    return this.billing.overview();
  }

  @Get('companies')
  @HttpCode(HttpStatus.OK)
  companies(
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.billing.listCompanies(status, q);
  }

  /** Extend / revive a gym trial. */
  @Post('companies/:companyId/extend-trial')
  @HttpCode(HttpStatus.OK)
  extendTrial(
    @Param('companyId') companyId: string,
    @Body() body: ExtendTrialDto,
    @CurrentUser() user: {
      userId: string;
      name?: string;
      email?: string;
      role?: string;
    },
  ) {
    return this.billing.extendTrial(
      companyId,
      { days: body.days, until: body.until },
      {
        userId: user.userId,
        name: user.name || 'SUPER_ADMIN',
        email: user.email || null,
        role: user.role || 'SUPER_ADMIN',
      },
    );
  }

  /**
   * Activity for the gym SUPER_ADMIN is currently viewing only.
   * Pass companyId or rely on active company context.
   */
  @Get('activity')
  @HttpCode(HttpStatus.OK)
  activity(
    @CurrentUser('companyId') activeCompanyId: string | null,
    @Query('companyId') companyId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const gymId = (companyId || activeCompanyId || '').trim();
    return this.activityLogs.findPlatformRecent({
      companyId: gymId,
      q,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('plans')
  @HttpCode(HttpStatus.OK)
  allPlans() {
    return this.plans.listAll();
  }

  @Post('plans')
  @HttpCode(HttpStatus.CREATED)
  createPlan(@Body() body: CreatePlatformPlanDto) {
    return this.plans.create(body as any);
  }

  @Post('plans/:id/archive')
  @HttpCode(HttpStatus.OK)
  archivePlan(@Param('id') id: string) {
    return this.plans.archive(id);
  }

  /** Custom plan leads from gyms. */
  @Get('inquiries')
  @HttpCode(HttpStatus.OK)
  listInquiries(@Query('status') status?: string) {
    return this.inquiries.listForAdmin(status);
  }

  @Patch('inquiries/:id')
  @HttpCode(HttpStatus.OK)
  updateInquiry(
    @Param('id') id: string,
    @Body() body: InquiryStatusDto,
    @CurrentUser() user: {
      userId: string;
      name?: string;
      email?: string;
      role?: string;
    },
  ) {
    return this.inquiries.updateStatus(id, body.status, body.adminNotes, {
      userId: user.userId,
      name: user.name || 'SUPER_ADMIN',
      email: user.email || null,
      role: user.role || 'SUPER_ADMIN',
    });
  }

  /** Run the billing sweep now instead of waiting for the timer. */
  @Post('billing/run')
  @HttpCode(HttpStatus.OK)
  runSweep() {
    return this.worker.sweep();
  }
}
