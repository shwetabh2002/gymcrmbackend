import {
  Body,
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
import { IsOptional, IsString } from 'class-validator';
import { PaymentProviderService } from './payment-provider.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { SubscriptionGuard } from '../platform-billing/guards/subscription.guard';

class ConnectApiKeysDto {
  @IsString()
  keyId: string;

  @IsString()
  keySecret: string;

  @IsOptional()
  @IsString()
  accountName?: string;
}

class WebhookSecretDto {
  /** Empty string clears the gym-specific secret (env secret takes over). */
  @IsString()
  secret: string;
}

/** Path must not live under /payments/:id (Nest registers PaymentsController first). */
@Controller('payment-provider')
export class PaymentProviderController {
  constructor(
    private readonly provider: PaymentProviderService,
    private readonly runtime: RuntimeService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
  @RequirePermissions(Permission.SETTINGS_VIEW, Permission.SETTINGS_UPDATE)
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
    @Res() res: Response,
  ) {
    try {
      if (!code || !state) throw new Error('Missing code/state');
      await this.provider.handleOAuthCallback(code, state);
      return res.redirect(
        this.runtime.crmUrl(`${CRM_ROUTES.settings}?razorpay=connected`),
      );
    } catch {
      return res.redirect(
        this.runtime.crmUrl(`${CRM_ROUTES.settings}?razorpay=error`),
      );
    }
  }

  @Post('razorpay/api-keys')
  @UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  connectKeys(
    @CompanyId() companyId: string,
    @Request() req: any,
    @Body() body: ConnectApiKeysDto,
  ) {
    return this.provider.connectApiKeys(
      companyId,
      req.user.userId,
      body.keyId,
      body.keySecret,
      body.accountName,
    );
  }

  @Post('razorpay/mock')
  @UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  connectMock(@CompanyId() companyId: string, @Request() req: any) {
    return this.provider.connectMock(companyId, req.user.userId);
  }

  /** Gym pastes the signing secret it created in its own Razorpay dashboard. */
  @Post('razorpay/webhook-secret')
  @UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  setWebhookSecret(
    @CompanyId() companyId: string,
    @Body() body: WebhookSecretDto,
  ) {
    return this.provider.setWebhookSecret(companyId, body.secret);
  }

  @Post('razorpay/disconnect')
  @UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  disconnect(@CompanyId() companyId: string) {
    return this.provider.disconnect(companyId);
  }
}
