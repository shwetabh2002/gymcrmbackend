import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class EmployeeAccessGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Get password from header
    const password = request.headers['x-employee-password'] as string;

    if (!password) {
      throw new UnauthorizedException('Employee section password required in X-Employee-Password header');
    }

    // Verify password
    const correctPassword = this.configService.get<string>('EMPLOYEE_SECTION_PASSWORD');
    if (!correctPassword) {
      throw new Error('EMPLOYEE_SECTION_PASSWORD not configured in environment');
    }

    if (password !== correctPassword) {
      throw new UnauthorizedException('Invalid employee section password');
    }

    return true;
  }
}
