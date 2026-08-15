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
import { IsOptional, IsString } from 'class-validator';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { SubscriptionGuard } from '../platform-billing/guards/subscription.guard';

class ConnectCloudDto {
  @IsString()
  cloudToken: string;

  @IsString()
  phoneNumberId: string;

  @IsString()
  paymentTemplate: string;

  @IsOptional()
  @IsString()
  templateLanguage?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  /** The gym's own WhatsApp number, shown to members. */
  @IsOptional()
  @IsString()
  senderNumber?: string;
}

class ConnectClickToChatDto {
  /** Gym's WhatsApp number with country code. */
  @IsString()
  senderNumber: string;
}

@Controller('whatsapp')
@UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get()
  @RequirePermissions(Permission.SETTINGS_VIEW, Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  status(@CompanyId() companyId: string) {
    return this.whatsapp.getStatus(companyId);
  }

  @Post('mock')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  connectMock(@CompanyId() companyId: string) {
    return this.whatsapp.connectMock(companyId);
  }

  /** Gym's own number, staff taps Send — no Meta Cloud API needed. */
  @Post('click-to-chat')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  connectClickToChat(
    @CompanyId() companyId: string,
    @Body() body: ConnectClickToChatDto,
  ) {
    return this.whatsapp.connectClickToChat(companyId, body.senderNumber);
  }

  @Post('cloud')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  connectCloud(@CompanyId() companyId: string, @Body() body: ConnectCloudDto) {
    return this.whatsapp.connectCloudApi(companyId, body);
  }

  @Post('disconnect')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  disconnect(@CompanyId() companyId: string) {
    return this.whatsapp.disconnect(companyId);
  }

  @Get('messages')
  @RequirePermissions(Permission.SETTINGS_VIEW, Permission.PAYMENTS_VIEW)
  @HttpCode(HttpStatus.OK)
  messages(@CompanyId() companyId: string, @Query('limit') limit?: string) {
    return this.whatsapp.listRecentMessages(
      companyId,
      Math.min(Number(limit) || 20, 100),
    );
  }
}
