import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AutopayWorkerService } from './autopay-worker.service';
import { MandatesService } from './mandates.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';

@Controller('autopay')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AutopayController {
  constructor(
    private readonly worker: AutopayWorkerService,
    private readonly mandates: MandatesService,
  ) {}

  /** Manual sweep — scoped to the caller's gym so one gym cannot bill another. */
  @Post('run')
  @RequirePermissions(Permission.SETTINGS_UPDATE, Permission.PAYMENTS_CREATE)
  @HttpCode(HttpStatus.OK)
  run(@CompanyId() companyId: string) {
    return this.worker.processDueCharges(companyId);
  }

  /** Mandate health for one subscription — drives the CRM autopay badge. */
  @Get('mandate/:subscriptionId')
  @RequirePermissions(Permission.SUBSCRIPTIONS_VIEW)
  @HttpCode(HttpStatus.OK)
  mandate(
    @CompanyId() companyId: string,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.mandates.getMandateForSubscription(companyId, subscriptionId);
  }

  /** Member wants off autopay — cancel at Razorpay, fall back to manual. */
  @Post('mandate/:subscriptionId/cancel')
  @RequirePermissions(Permission.SUBSCRIPTIONS_UPDATE)
  @HttpCode(HttpStatus.OK)
  cancelMandate(
    @CompanyId() companyId: string,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.mandates.cancelMandate(companyId, subscriptionId);
  }
}
