import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';
import { RenewalsService } from './renewals.service';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { RenewalFollowUpStatus } from '../common/enums/renewal-follow-up-status.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { LocationScope } from '../common/tenant/location.decorator';

@Controller('renewals')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RenewalsController {
  constructor(private readonly renewalsService: RenewalsService) {}

  @Get('queue')
  @RequirePermissions(Permission.RENEWALS_VIEW)
  @HttpCode(HttpStatus.OK)
  async getQueue(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Query('withinDays') withinDays?: string,
    @Query('includeExpired') includeExpired?: string,
    @Query('expiredWithinDays') expiredWithinDays?: string,
    @Query('status') status?: RenewalFollowUpStatus | 'OPEN' | 'ALL',
  ) {
    return this.renewalsService.getQueue(companyId, {
      withinDays: withinDays ? Number(withinDays) : undefined,
      includeExpired:
        includeExpired === undefined ? undefined : includeExpired !== 'false',
      expiredWithinDays: expiredWithinDays
        ? Number(expiredWithinDays)
        : undefined,
      status,
      ...locScope,
    });
  }

  @Get('queue/counts')
  @RequirePermissions(Permission.RENEWALS_VIEW)
  @HttpCode(HttpStatus.OK)
  async getCounts(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Query('withinDays') withinDays?: string,
    @Query('expiredWithinDays') expiredWithinDays?: string,
  ) {
    return this.renewalsService.getCounts(
      companyId,
      withinDays ? Number(withinDays) : 7,
      expiredWithinDays ? Number(expiredWithinDays) : 30,
      locScope,
    );
  }

  @Patch(':subscriptionId/follow-up')
  @RequirePermissions(Permission.RENEWALS_UPDATE)
  @HttpCode(HttpStatus.OK)
  async updateFollowUp(
    @CompanyId() companyId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: UpdateFollowUpDto,
    @Request() req,
  ) {
    return this.renewalsService.updateFollowUp(companyId, subscriptionId, dto, {
      userId: req.user?.userId,
      name: req.user?.name || req.user?.email || 'Unknown',
    });
  }
}
