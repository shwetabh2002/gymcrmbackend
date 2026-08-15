import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LOGIN_THROTTLE } from '../config/throttle.config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BillingExempt } from '../platform-billing/decorators/billing.decorators';

@Controller('auth')
@BillingExempt()
export class AuthController {
  constructor(private authService: AuthService) {}

  // Brute-force protection: max 5 login attempts / minute per IP.
  @Throttle({ default: LOGIN_THROTTLE })
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  async adminLogin(@Body() loginDto: LoginDto) {
    return this.authService.adminLogin(loginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtRefreshGuard)
  async refreshTokens(
    @CurrentUser('userId') userId: string,
    @CurrentUser('refreshToken') refreshToken: string,
  ) {
    return this.authService.refreshTokens(userId, refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser('userId') userId: string) {
    return this.authService.logout(userId);
  }
}
