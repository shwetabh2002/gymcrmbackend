import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  locationFilter,
  requireLocationIdForWrite,
  TenantRequestUser,
} from './tenant.util';

/** Active location filter from session (may be empty = all) */
export const LocationScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { locationId?: string } => {
    const request = ctx.switchToHttp().getRequest();
    return locationFilter(request.user as TenantRequestUser);
  },
);

/**
 * Resolve location for writes.
 * Uses body.locationId if present, else session active location.
 */
export const WriteLocationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const bodyId = request.body?.locationId;
    return requireLocationIdForWrite(request.user, bodyId);
  },
);
