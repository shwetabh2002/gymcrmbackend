import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RuntimeService } from '../common/runtime/runtime.service';
import { CRM_ROUTES } from '../config/crm-routes.config';
import { PaymentProviderService } from './payment-provider.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { SubscriptionGuard } from '../platform-billing/guards/subscription.guard';

/** Path must not live under /payments/:id (Nest registers PaymentsController first). */
@Controller('payment-provider')
export class PaymentProviderController {
  constructor(
    private readonly provider: PaymentProviderService,
    private readonly runtime: RuntimeService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
  @RequirePermissions(
    Permission.SETTINGS_VIEW,
    Permission.SETTINGS_UPDATE,
    Permission.MEMBERS_CREATE,
  )
  @HttpCode(HttpStatus.OK)
  status(@CompanyId() companyId: string) {
    return this.provider.getStatus(companyId);
  }

  @Get('razorpay/connect')
  @UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  async startConnect(@CompanyId() companyId: string, @Request() req: any) {
    return this.provider.startOAuth(companyId, req.user.userId);
  }

  /** Browser redirect from Razorpay — no JWT; state binds company */
  @Get('razorpay/callback')
  @HttpCode(HttpStatus.OK)
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') oauthError: string,
    @Res() res: Response,
  ) {
    try {
      if (oauthError) {
        await this.provider.discardOAuthState(state);
        const flag = oauthError === 'access_denied' ? 'cancelled' : 'error';
        return res.redirect(
          this.runtime.crmUrl(`${CRM_ROUTES.paymentSettings}?razorpay=${flag}`),
        );
      }
      if (!code || !state) throw new Error('Missing code/state');
      await this.provider.handleOAuthCallback(code, state);
      return res.redirect(
        this.runtime.crmUrl(`${CRM_ROUTES.paymentSettings}?razorpay=connected`),
      );
    } catch {
      await this.provider.discardOAuthState(state);
      return res.redirect(
        this.runtime.crmUrl(`${CRM_ROUTES.paymentSettings}?razorpay=error`),
      );
    }
  }

  @Post('razorpay/mock')
  @UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  connectMock(@CompanyId() companyId: string, @Request() req: any) {
    return this.provider.connectMock(companyId, req.user.userId);
  }

  @Post('razorpay/disconnect')
  @UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  disconnect(@CompanyId() companyId: string) {
    return this.provider.disconnect(companyId);
  }
}
