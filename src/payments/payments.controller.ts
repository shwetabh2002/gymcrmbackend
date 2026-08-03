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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { LocationScope } from '../common/tenant/location.decorator';
import { getUploadLimits } from '../config/upload.config';
import { ParseMongoIdPipe } from '../common/pipes/parse-mongo-id.pipe';

@Controller('payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @RequirePermissions(Permission.PAYMENTS_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CompanyId() companyId: string,
    @Body() createDto: CreatePaymentDto,
    @Request() req,
  ) {
    const writeLocationId =
      (createDto as any).locationId || req.user?.locationId || undefined;
    return this.paymentsService.create(
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

  @Post(':id/proof')
  @RequirePermissions(Permission.PAYMENTS_CREATE, Permission.PAYMENTS_UPDATE)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: getUploadLimits().maxFileBytes },
    }),
  )
  async uploadProof(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id', ParseMongoIdPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.paymentsService.uploadProof(companyId, id, file, locScope);
  }

  @Get()
  @RequirePermissions(Permission.PAYMENTS_VIEW)
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
  ) {
    return this.paymentsService.findAll(companyId, locScope);
  }

  @Get('member/:memberId')
  @RequirePermissions(Permission.PAYMENTS_VIEW)
  @HttpCode(HttpStatus.OK)
  async findByMemberId(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('memberId') memberId: string,
  ) {
    return this.paymentsService.findByMemberId(companyId, memberId, locScope);
  }

  @Get('subscription/:subscriptionId')
  @RequirePermissions(Permission.PAYMENTS_VIEW)
  @HttpCode(HttpStatus.OK)
  async findBySubscriptionId(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.paymentsService.findBySubscriptionId(
      companyId,
      subscriptionId,
      locScope,
    );
  }

  @Get(':id')
  @RequirePermissions(Permission.PAYMENTS_VIEW)
  @HttpCode(HttpStatus.OK)
  async findById(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id', ParseMongoIdPipe) id: string,
  ) {
    return this.paymentsService.findById(companyId, id, locScope);
  }

  @Put(':id')
  @RequirePermissions(Permission.PAYMENTS_UPDATE)
  @HttpCode(HttpStatus.OK)
  async update(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id', ParseMongoIdPipe) id: string,
    @Body() updateDto: UpdatePaymentDto,
    @Request() req,
  ) {
    return this.paymentsService.update(
      companyId,
      id,
      updateDto,
      {
        userId: req.user.userId,
        name: req.user.name || req.user.email || 'Unknown',
      },
      locScope,
    );
  }

  @Delete(':id')
  @RequirePermissions(Permission.PAYMENTS_DELETE)
  @HttpCode(HttpStatus.OK)
  async delete(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id', ParseMongoIdPipe) id: string,
    @Request() req,
  ) {
    await this.paymentsService.delete(
      companyId,
      id,
      {
        userId: req.user.userId,
        name: req.user.name || req.user.email || 'Unknown',
      },
      locScope,
    );
    return { message: 'Payment deleted successfully' };
  }
}
