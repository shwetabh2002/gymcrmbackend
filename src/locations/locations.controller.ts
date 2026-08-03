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
import { LocationsService } from './locations.service';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('locations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @RequirePermissions(
    Permission.LOCATIONS_VIEW,
    Permission.SETTINGS_VIEW,
    Permission.MEMBERS_VIEW,
  )
  @HttpCode(HttpStatus.OK)
  findAll(@CompanyId() companyId: string) {
    return this.locationsService.findAll(companyId);
  }

  @Post()
  @RequirePermissions(Permission.LOCATIONS_CREATE)
  @HttpCode(HttpStatus.CREATED)
  create(@CompanyId() companyId: string, @Body() dto: CreateLocationDto) {
    return this.locationsService.create(companyId, dto);
  }

  @Post('active/clear')
  @RequirePermissions(Permission.DASHBOARD, Permission.MEMBERS_VIEW)
  @HttpCode(HttpStatus.OK)
  clearActive(@CurrentUser('userId') userId: string) {
    return this.locationsService.clearActiveLocation(userId);
  }

  @Post(':id/select')
  @RequirePermissions(Permission.DASHBOARD, Permission.MEMBERS_VIEW)
  @HttpCode(HttpStatus.OK)
  select(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.locationsService.selectLocation(userId, companyId, id);
  }

  @Get(':id')
  @RequirePermissions(
    Permission.LOCATIONS_VIEW,
    Permission.SETTINGS_VIEW,
    Permission.MEMBERS_VIEW,
  )
  @HttpCode(HttpStatus.OK)
  findById(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.locationsService.findById(companyId, id);
  }

  @Put(':id')
  @RequirePermissions(Permission.LOCATIONS_UPDATE)
  @HttpCode(HttpStatus.OK)
  update(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locationsService.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.LOCATIONS_DELETE)
  @HttpCode(HttpStatus.OK)
  delete(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.locationsService.delete(companyId, id);
  }
}
