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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { LocationScope } from '../common/tenant/location.decorator';

@Controller('invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @RequirePermissions(Permission.INVOICES_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CompanyId() companyId: string,
    @Body() createDto: CreateInvoiceDto,
    @Request() req,
  ) {
    const writeLocationId =
      (createDto as any).locationId || req.user?.locationId || undefined;
    return this.invoicesService.create(
      companyId,
      createDto,
      req.user.userId,
      {
        userId: req.user.userId,
        name: req.user.name || req.user.email || 'Unknown',
      },
      writeLocationId,
    );
  }

  @Get()
  @RequirePermissions(Permission.INVOICES_VIEW)
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
  ) {
    return this.invoicesService.findAll(companyId, locScope);
  }

  @Get(':id')
  @RequirePermissions(Permission.INVOICES_VIEW)
  @HttpCode(HttpStatus.OK)
  async findById(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
  ) {
    return this.invoicesService.findById(companyId, id, locScope);
  }

  @Get('member/:memberId')
  @RequirePermissions(Permission.INVOICES_VIEW)
  @HttpCode(HttpStatus.OK)
  async findByMemberId(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('memberId') memberId: string,
  ) {
    return this.invoicesService.findByMemberId(companyId, memberId, locScope);
  }

  @Get('subscription/:subscriptionId')
  @RequirePermissions(Permission.INVOICES_VIEW)
  @HttpCode(HttpStatus.OK)
  async findBySubscriptionId(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.invoicesService.findBySubscriptionId(
      companyId,
      subscriptionId,
      locScope,
    );
  }

  @Put(':id')
  @RequirePermissions(Permission.INVOICES_UPDATE)
  @HttpCode(HttpStatus.OK)
  async update(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
    @Body() updateDto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(companyId, id, updateDto, locScope);
  }

  @Delete(':id')
  @RequirePermissions(Permission.INVOICES_DELETE)
  @HttpCode(HttpStatus.OK)
  async delete(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
  ) {
    await this.invoicesService.delete(companyId, id, locScope);
    return { message: 'Invoice deleted successfully' };
  }
}
