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
} from '@nestjs/common';
import { DuesService, DuesSort } from './dues.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { LocationScope } from '../common/tenant/location.decorator';
import { SubscriptionGuard } from '../platform-billing/guards/subscription.guard';
import { MemberSubscriptionsService } from '../member-subscriptions/member-subscriptions.service';
import { UpdateDueReminderDto } from './dto/update-due-reminder.dto';

@Controller('dues')
@UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
export class DuesController {
  constructor(
    private readonly duesService: DuesService,
    private readonly subscriptionsService: MemberSubscriptionsService,
  ) {}

  @Get('queue')
  @RequirePermissions(Permission.PAYMENTS_VIEW)
  @HttpCode(HttpStatus.OK)
  async getQueue(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Query('sort') sort?: DuesSort,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('reminder') reminder?: 'ALL' | 'SET' | 'OVERDUE' | 'NONE',
  ) {
    return this.duesService.getQueue(companyId, {
      ...locScope,
      sort,
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      reminder,
    });
  }

  @Patch(':subscriptionId/reminder')
  @RequirePermissions(Permission.PAYMENTS_CREATE)
  @HttpCode(HttpStatus.OK)
  async updateReminder(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: UpdateDueReminderDto,
  ) {
    return this.subscriptionsService.update(
      companyId,
      subscriptionId,
      { dueReminderDate: dto.dueReminderDate ?? null },
      undefined,
      locScope,
    );
  }
}
