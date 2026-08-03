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
import { ConfigService } from '@nestjs/config';
import { IsOptional, IsString } from 'class-validator';
import { PaymentProviderService } from './payment-provider.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';

class ConnectApiKeysDto {
  @IsString()
  keyId: string;

  @IsString()
  keySecret: string;

  @IsOptional()
  @IsString()
  accountName?: string;
}

/** Path must not live under /payments/:id (Nest registers PaymentsController first). */
@Controller('payment-provider')
export class PaymentProviderController {
  constructor(
    private readonly provider: PaymentProviderService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.SETTINGS_VIEW, Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  status(@CompanyId() companyId: string) {
    return this.provider.getStatus(companyId);
  }

  @Get('razorpay/connect')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
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
    const frontend =
      this.config.get('CRM_PUBLIC_URL') ||
      this.config.get('FRONTEND_URL') ||
      'http://localhost:3000';
    try {
      if (!code || !state) throw new Error('Missing code/state');
      await this.provider.handleOAuthCallback(code, state);
      return res.redirect(`${frontend}/settings?razorpay=connected`);
    } catch {
      return res.redirect(`${frontend}/settings?razorpay=error`);
    }
  }

  @Post('razorpay/api-keys')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  connectMock(@CompanyId() companyId: string, @Request() req: any) {
    return this.provider.connectMock(companyId, req.user.userId);
  }

  @Post('razorpay/disconnect')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  disconnect(@CompanyId() companyId: string) {
    return this.provider.disconnect(companyId);
  }
}
