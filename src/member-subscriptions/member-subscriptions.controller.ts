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
import { MemberSubscriptionsService } from './member-subscriptions.service';
import { CreateMemberSubscriptionDto } from './dto/create-member-subscription.dto';
import { UpdateMemberSubscriptionDto } from './dto/update-member-subscription.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('member-subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
export class MemberSubscriptionsController {
  constructor(
    private readonly memberSubscriptionsService: MemberSubscriptionsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateMemberSubscriptionDto) {
    return this.memberSubscriptionsService.create(createDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll() {
    return this.memberSubscriptionsService.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string) {
    return this.memberSubscriptionsService.findById(id);
  }

  @Get('member/:memberId')
  @HttpCode(HttpStatus.OK)
  async findByMemberId(@Param('memberId') memberId: string) {
    return this.memberSubscriptionsService.findByMemberId(memberId);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateMemberSubscriptionDto,
  ) {
    return this.memberSubscriptionsService.update(id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.memberSubscriptionsService.delete(id);
    return { message: 'Member subscription deleted successfully' };
  }

  @Post(':id/payment')
  @HttpCode(HttpStatus.OK)
  async addPayment(
    @Param('id') id: string,
    @Body('amount') amount: number,
  ) {
    return this.memberSubscriptionsService.addPayment(id, amount);
  }
}
