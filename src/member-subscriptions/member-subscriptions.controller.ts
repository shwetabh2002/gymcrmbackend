import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';
import { MemberSubscriptionsService } from './member-subscriptions.service';
import { CreateMemberSubscriptionDto } from './dto/create-member-subscription.dto';
import { UpdateMemberSubscriptionDto } from './dto/update-member-subscription.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { LocationScope } from '../common/tenant/location.decorator';

@Controller('member-subscriptions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MemberSubscriptionsController {
  constructor(
    private readonly memberSubscriptionsService: MemberSubscriptionsService,
  ) {}

  @Post()
  @RequirePermissions(Permission.SUBSCRIPTIONS_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CompanyId() companyId: string,
    @Body() createDto: CreateMemberSubscriptionDto,
    @Request() req,
  ) {
    const writeLocationId =
      (createDto as any).locationId || req.user?.locationId || undefined;
    return this.memberSubscriptionsService.create(
      companyId,
      createDto,
      {
        userId: req.user?.userId,
        name: req.user?.name || req.user?.email || 'Unknown',
      },
      writeLocationId,
    );
  }

  @Get()
  @RequirePermissions(Permission.SUBSCRIPTIONS_VIEW)
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
  ) {
    return this.memberSubscriptionsService.findAll(companyId, locScope);
  }

  @Get(':id')
  @RequirePermissions(Permission.SUBSCRIPTIONS_VIEW)
  @HttpCode(HttpStatus.OK)
  async findById(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
  ) {
    return this.memberSubscriptionsService.findById(companyId, id, locScope);
  }

  @Get('member/:memberId')
  @RequirePermissions(Permission.SUBSCRIPTIONS_VIEW)
  @HttpCode(HttpStatus.OK)
  async findByMemberId(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('memberId') memberId: string,
  ) {
    return this.memberSubscriptionsService.findByMemberId(
      companyId,
      memberId,
      locScope,
    );
  }

  @Put(':id')
  @RequirePermissions(Permission.SUBSCRIPTIONS_UPDATE)
  @HttpCode(HttpStatus.OK)
  async update(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
    @Body() updateDto: UpdateMemberSubscriptionDto,
    @Request() req,
  ) {
    return this.memberSubscriptionsService.update(
      companyId,
      id,
      updateDto,
      {
        userId: req.user?.userId,
        name: req.user?.name || req.user?.email || 'Unknown',
      },
      locScope,
    );
  }

  @Delete(':id')
  @RequirePermissions(Permission.SUBSCRIPTIONS_DELETE)
  @HttpCode(HttpStatus.OK)
  async delete(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
    @Request() req,
  ) {
    await this.memberSubscriptionsService.delete(
      companyId,
      id,
      {
        userId: req.user?.userId,
        name: req.user?.name || req.user?.email || 'Unknown',
      },
      locScope,
    );
    return { message: 'Member subscription deleted successfully' };
  }

  @Post(':id/payment')
  @RequirePermissions(Permission.PAYMENTS_CREATE)
  @HttpCode(HttpStatus.OK)
  async addPayment(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body('amount') amount: number,
  ) {
    return this.memberSubscriptionsService.addPayment(companyId, id, amount);
  }
}
