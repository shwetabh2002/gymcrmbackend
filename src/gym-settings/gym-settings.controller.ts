import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { GymSettingsService } from './gym-settings.service';
import { UpdateGymSettingsDto } from './dto/update-gym-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { getUploadLimits } from '../config/upload.config';
import { SubscriptionGuard } from '../platform-billing/guards/subscription.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('gym-settings')
@UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
export class GymSettingsController {
  constructor(private readonly gymSettingsService: GymSettingsService) {}

  @Get()
  @RequirePermissions(
    Permission.SETTINGS_VIEW,
    Permission.MEMBERS_CREATE,
    Permission.DASHBOARD,
  )
  @HttpCode(HttpStatus.OK)
  get(@CompanyId() companyId: string) {
    return this.gymSettingsService.get(companyId);
  }

  @Put()
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.OK)
  update(
    @CompanyId() companyId: string,
    @Body() dto: UpdateGymSettingsDto,
    @CurrentUser('role') role: string,
  ) {
    return this.gymSettingsService.update(companyId, dto, role);
  }

  @Post('upload')
  @RequirePermissions(Permission.SETTINGS_UPDATE, Permission.SETTINGS_CREATE)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: getUploadLimits().maxFileBytes },
    }),
  )
  upload(
    @CompanyId() companyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('kind') kind?: string,
  ) {
    if (!file) throw new BadRequestException('file is required');
    const k =
      kind === 'favicon' ? 'favicon' : kind === 'stamp' ? 'stamp' : 'logo';
    return this.gymSettingsService.uploadBrandAsset(companyId, file, k);
  }
}
