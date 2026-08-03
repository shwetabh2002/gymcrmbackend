import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AutopayWorkerService } from './autopay-worker.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';

@Controller('autopay')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AutopayController {
  constructor(private readonly worker: AutopayWorkerService) {}

  @Post('run')
  @RequirePermissions(Permission.SETTINGS_UPDATE, Permission.PAYMENTS_CREATE)
  @HttpCode(HttpStatus.OK)
  run() {
    return this.worker.processDueCharges();
  }
}
