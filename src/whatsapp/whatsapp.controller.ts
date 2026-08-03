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
}

@Controller('whatsapp')
@UseGuards(JwtAuthGuard, PermissionsGuard)
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
  messages(
    @CompanyId() companyId: string,
    @Query('limit') limit?: string,
  ) {
    return this.whatsapp.listRecentMessages(
      companyId,
      Math.min(Number(limit) || 20, 100),
    );
  }
}
