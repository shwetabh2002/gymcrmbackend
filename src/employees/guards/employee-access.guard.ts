import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class EmployeeAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const session = request.session as any;

    // Check if employee section is unlocked in session
    if (!session?.employeeSectionUnlocked) {
      throw new UnauthorizedException('Employee section is locked. Please unlock first.');
    }

    return true;
  }
}
