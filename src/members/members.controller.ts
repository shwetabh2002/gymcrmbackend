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
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permission } from '../common/enums/permission.enum';
import { CompanyId } from '../common/tenant/company-id.decorator';
import {
  LocationScope,
  WriteLocationId,
} from '../common/tenant/location.decorator';
import { getUploadLimits } from '../config/upload.config';

function actorFromReq(req: any) {
  return req?.user
    ? { userId: req.user.userId, name: req.user.name || req.user.email }
    : undefined;
}

@Controller('members')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Post()
  @RequirePermissions(Permission.MEMBERS_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CompanyId() companyId: string,
    @WriteLocationId() locationId: string,
    @Body() createDto: CreateMemberDto,
    @Request() req,
  ) {
    return this.membersService.create(
      companyId,
      locationId,
      createDto,
      req.user?.userId,
      actorFromReq(req),
    );
  }

  @Get()
  @RequirePermissions(Permission.MEMBERS_VIEW)
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
  ) {
    return this.membersService.findAll(companyId, locScope);
  }

  @Get(':id')
  @RequirePermissions(Permission.MEMBERS_VIEW)
  @HttpCode(HttpStatus.OK)
  async findById(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
  ) {
    return this.membersService.findById(companyId, id, locScope);
  }

  @Post(':id/photo')
  @RequirePermissions(Permission.MEMBERS_UPDATE, Permission.MEMBERS_CREATE)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: getUploadLimits().maxFileBytes },
    }),
  )
  async uploadPhoto(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.membersService.uploadPhoto(companyId, id, file, locScope);
  }

  @Put(':id')
  @RequirePermissions(Permission.MEMBERS_UPDATE, Permission.MEMBERS_CREATE)
  @HttpCode(HttpStatus.OK)
  async update(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
    @Body() updateDto: UpdateMemberDto,
    @Request() req,
  ) {
    return this.membersService.update(
      companyId,
      id,
      updateDto,
      actorFromReq(req),
      locScope,
    );
  }

  @Delete(':id')
  @RequirePermissions(Permission.MEMBERS_DELETE)
  @HttpCode(HttpStatus.OK)
  async delete(
    @CompanyId() companyId: string,
    @LocationScope() locScope: { locationId?: string },
    @Param('id') id: string,
    @Request() req,
  ) {
    await this.membersService.delete(
      companyId,
      id,
      actorFromReq(req),
      locScope,
    );
    return { message: 'Member deleted successfully' };
  }
}
