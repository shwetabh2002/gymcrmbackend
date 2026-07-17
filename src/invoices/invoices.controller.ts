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
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateInvoiceDto, @Request() req) {
    return this.invoicesService.create(createDto, req.user.userId);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll() {
    return this.invoicesService.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string) {
    return this.invoicesService.findById(id);
  }

  @Get('member/:memberId')
  @HttpCode(HttpStatus.OK)
  async findByMemberId(@Param('memberId') memberId: string) {
    return this.invoicesService.findByMemberId(memberId);
  }

  @Get('subscription/:subscriptionId')
  @HttpCode(HttpStatus.OK)
  async findBySubscriptionId(@Param('subscriptionId') subscriptionId: string) {
    return this.invoicesService.findBySubscriptionId(subscriptionId);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() updateDto: UpdateInvoiceDto) {
    return this.invoicesService.update(id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.invoicesService.delete(id);
    return { message: 'Invoice deleted successfully' };
  }
}
