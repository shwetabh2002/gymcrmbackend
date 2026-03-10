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
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreatePaymentDto, @Request() req) {
    return this.paymentsService.create(createDto, req.user.userId);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll() {
    return this.paymentsService.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string) {
    return this.paymentsService.findById(id);
  }

  @Get('member/:memberId')
  @HttpCode(HttpStatus.OK)
  async findByMemberId(@Param('memberId') memberId: string) {
    return this.paymentsService.findByMemberId(memberId);
  }

  @Get('subscription/:subscriptionId')
  @HttpCode(HttpStatus.OK)
  async findBySubscriptionId(@Param('subscriptionId') subscriptionId: string) {
    return this.paymentsService.findBySubscriptionId(subscriptionId);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() updateDto: UpdatePaymentDto) {
    return this.paymentsService.update(id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.paymentsService.delete(id);
    return { message: 'Payment deleted successfully' };
  }
}
