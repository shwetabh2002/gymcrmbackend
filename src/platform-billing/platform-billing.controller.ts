import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformChargingService } from './platform-charging.service';
import { PlatformPlansService } from './platform-plans.service';
import { PlatformBillingWorkerService } from './platform-billing-worker.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { BillingExempt } from './decorators/billing.decorators';
import { BILLING_INTERVALS } from '../config/platform-billing.config';

class ChangePlanDto {
  @IsString()
  planCode: string;

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

/**
 * A gym's own subscription screen.
 *
 * Every route here is billing-exempt: a gym whose trial lapsed must still be
 * able to see its standing and pay, otherwise the gate would lock out exactly
 * the people trying to become customers.
 */
@Controller('subscription')
@UseGuards(JwtAuthGuard)
@BillingExempt()
export class PlatformBillingController {
  constructor(
    private readonly billing: PlatformBillingService,
    private readonly charging: PlatformChargingService,
    private readonly plans: PlatformPlansService,
  ) {}

  /** Where this gym stands: plan, status, days left, what renewal will cost. */
  @Get()
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
  @HttpCode(HttpStatus.OK)
  availablePlans() {
    return this.plans.listPublic();
  }

  /** Past charges — the gym's own billing history with us. */
  @Get('invoices')
  @HttpCode(HttpStatus.OK)
  invoices(@CompanyId() companyId: string) {
    return this.billing.charges(companyId);
  }

  @Post('plan')
  @HttpCode(HttpStatus.OK)
  changePlan(@CompanyId() companyId: string, @Body() body: ChangePlanDto) {
    return this.billing.changePlan(
      companyId,
      body.planCode,
      body.interval || 'MONTHLY',
    );
  }

  /**
   * Starts the UPI Autopay mandate for our fees. The returned link is what the
   * gym owner approves; the first period is charged in the same step.
   */
  @Post('mandate')
  @HttpCode(HttpStatus.OK)
  startMandate(@CompanyId() companyId: string) {
    return this.charging.startMandate(companyId);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CompanyId() companyId: string, @Body() body: CancelDto) {
    return this.billing.cancel(companyId, body.reason);
  }

  @Post('resume')
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
  ) {}

  /** Counts by status, MRR, lifetime revenue, trials ending soon. */
  @Get('overview')
  @HttpCode(HttpStatus.OK)
  overview() {
    return this.billing.overview();
  }

  @Get('companies')
  @HttpCode(HttpStatus.OK)
  companies(@Query('status') status?: string) {
    return this.billing.listCompanies(status);
  }

  @Get('plans')
  @HttpCode(HttpStatus.OK)
  allPlans() {
    return this.plans.listAll();
  }

  @Post('plans')
  @HttpCode(HttpStatus.CREATED)
  createPlan(@Body() body: any) {
    return this.plans.create(body);
  }

  @Post('plans/:id/archive')
  @HttpCode(HttpStatus.OK)
  archivePlan(@Query('id') id: string) {
    return this.plans.archive(id);
  }

  /** Run the billing sweep now instead of waiting for the timer. */
  @Post('billing/run')
  @HttpCode(HttpStatus.OK)
  runSweep() {
    return this.worker.sweep();
  }
}
