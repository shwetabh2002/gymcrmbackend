import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { EmailTemplatesService } from './email-templates.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { SubscriptionGuard } from '../platform-billing/guards/subscription.guard';

class UpdateEmailTemplateDto {
  /** Empty string restores the platform default. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  body?: string;

  /** Off = this gym never sends this email. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** Settings → Email: each gym writes its own copy for member-facing mails. */
@Controller('email-templates')
@UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
export class EmailTemplatesController {
  constructor(private readonly templates: EmailTemplatesService) {}

  @Get()
  @RequirePermissions(Permission.SETTINGS_VIEW, Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  list(@CompanyId() companyId: string) {
    return this.templates.listForGym(companyId);
  }

  /** Rendered with sample data so the gym sees the real thing. */
  @Get(':type/preview')
  @RequirePermissions(Permission.SETTINGS_VIEW, Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  preview(@CompanyId() companyId: string, @Param('type') type: string) {
    return this.templates.preview(companyId, type);
  }

  @Put(':type')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  update(
    @CompanyId() companyId: string,
    @Param('type') type: string,
    @Body() body: UpdateEmailTemplateDto,
    @Request() req: any,
  ) {
    return this.templates.upsertForGym(companyId, type, body, req.user?.userId);
  }

  @Post(':type/reset')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  reset(@CompanyId() companyId: string, @Param('type') type: string) {
    return this.templates.resetForGym(companyId, type);
  }
}
