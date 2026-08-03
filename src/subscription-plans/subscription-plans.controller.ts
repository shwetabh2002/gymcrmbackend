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
} from '@nestjs/common';
import { SubscriptionPlansService } from './subscription-plans.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';

@Controller('subscription-plans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SubscriptionPlansController {
  constructor(
    private readonly subscriptionPlansService: SubscriptionPlansService,
  ) {}

  @Post()
  @RequirePermissions(Permission.PLANS_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CompanyId() companyId: string,
    @Body() createDto: CreateSubscriptionPlanDto,
  ) {
    return this.subscriptionPlansService.create(companyId, createDto);
  }

  @Get()
  @RequirePermissions(Permission.PLANS_VIEW)
  @HttpCode(HttpStatus.OK)
  async findAll(@CompanyId() companyId: string) {
    return this.subscriptionPlansService.findAll(companyId);
  }

  @Get(':id')
  @RequirePermissions(Permission.PLANS_VIEW)
  @HttpCode(HttpStatus.OK)
  async findById(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.subscriptionPlansService.findById(companyId, id);
  }

  @Put(':id')
  @RequirePermissions(Permission.PLANS_UPDATE)
  @HttpCode(HttpStatus.OK)
  async update(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() updateDto: UpdateSubscriptionPlanDto,
  ) {
    return this.subscriptionPlansService.update(companyId, id, updateDto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.PLANS_DELETE)
  @HttpCode(HttpStatus.OK)
  async delete(@CompanyId() companyId: string, @Param('id') id: string) {
    await this.subscriptionPlansService.delete(companyId, id);
    return { message: 'Subscription plan deleted successfully' };
  }
}
