import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
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
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { EmployeeType } from '../common/enums/employee-type.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { LocationScope } from '../common/tenant/location.decorator';
import { getUploadLimits } from '../config/upload.config';

@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @RequirePermissions(Permission.EMPLOYEES_CREATE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CompanyId() companyId: string,
    @Body() dto: CreateEmployeeDto,
    @Request() req,
  ) {
    return this.employeesService.create(companyId, dto, {
      userId: req.user?.userId,
      name: req.user?.name || req.user?.email || 'Unknown',
    });
  }

  @Get()
  @RequirePermissions(Permission.EMPLOYEES_VIEW)
  @HttpCode(HttpStatus.OK)
  findAll(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Query('type') type?: EmployeeType,
    @Query('status') status?: AccountStatus,
  ) {
    return this.employeesService.findAll(companyId, type, status, locScope);
  }

  @Get(':id')
  @RequirePermissions(Permission.EMPLOYEES_VIEW)
  @HttpCode(HttpStatus.OK)
  findById(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
  ) {
    return this.employeesService.findById(companyId, id, locScope);
  }

  @Post(':id/photo')
  @RequirePermissions(
    Permission.EMPLOYEES_UPDATE,
    Permission.EMPLOYEES_CREATE,
  )
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: getUploadLimits().maxFileBytes },
    }),
  )
  uploadPhoto(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.employeesService.uploadPhoto(companyId, id, file, locScope);
  }

  @Put(':id')
  @RequirePermissions(Permission.EMPLOYEES_UPDATE)
  @HttpCode(HttpStatus.OK)
  update(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @Request() req,
  ) {
    return this.employeesService.update(
      companyId,
      id,
      dto,
      {
        userId: req.user?.userId,
        name: req.user?.name || req.user?.email || 'Unknown',
      },
      locScope,
    );
  }

  @Delete(':id')
  @RequirePermissions(Permission.EMPLOYEES_DELETE)
  @HttpCode(HttpStatus.OK)
  delete(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
    @Request() req,
  ) {
    return this.employeesService.delete(
      companyId,
      id,
      {
        userId: req.user?.userId,
        name: req.user?.name || req.user?.email || 'Unknown',
      },
      locScope,
    );
  }
}
