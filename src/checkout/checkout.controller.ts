import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';

@Controller('members/checkout')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  @RequirePermissions(Permission.MEMBERS_CREATE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CompanyId() companyId: string,
    @Body() dto: CreateCheckoutDto,
    @Request() req: any,
  ) {
    return this.checkout.createCheckout(companyId, dto, req.user.userId);
  }

  @Get(':sessionId')
  @RequirePermissions(Permission.MEMBERS_VIEW, Permission.MEMBERS_CREATE)
  @HttpCode(HttpStatus.OK)
  get(@CompanyId() companyId: string, @Param('sessionId') sessionId: string) {
    return this.checkout.getSession(companyId, sessionId);
  }

  @Post(':sessionId/resend')
  @RequirePermissions(Permission.MEMBERS_CREATE)
  @HttpCode(HttpStatus.OK)
  resend(
    @CompanyId() companyId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.checkout.resend(companyId, sessionId);
  }

  @Post(':sessionId/cancel')
  @RequirePermissions(Permission.MEMBERS_CREATE)
  @HttpCode(HttpStatus.OK)
  cancel(
    @CompanyId() companyId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.checkout.cancel(companyId, sessionId);
  }
}
