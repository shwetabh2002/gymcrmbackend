import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CompaniesService } from './companies.service';
import { SelfSignupDto } from './dto/self-signup.dto';
import { ManualOnboardDto } from './dto/manual-onboard.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  /** Public — marketing site self-signup */
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  selfSignup(@Body() dto: SelfSignupDto) {
    return this.companiesService.selfSignup(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post('onboard')
  @HttpCode(HttpStatus.CREATED)
  manualOnboard(@Body() dto: ManualOnboardDto) {
    return this.companiesService.manualOnboard(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Get()
  @HttpCode(HttpStatus.OK)
  findAll() {
    return this.companiesService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post('active/clear')
  @HttpCode(HttpStatus.OK)
  clearActive(@CurrentUser('userId') userId: string) {
    return this.companiesService.clearActiveCompany(userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post(':id/select')
  @HttpCode(HttpStatus.OK)
  selectCompany(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.companiesService.selectCompany(userId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findById(@Param('id') id: string) {
    return this.companiesService.findById(id);
  }
}
