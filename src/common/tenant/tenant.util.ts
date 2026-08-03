import {
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Role } from '../enums/role.enum';

export type TenantRequestUser = {
  userId: string;
  email: string | null;
  role: string;
  name: string;
  userType?: string;
  permissions?: string[];
  companyId?: string | null;
  companyName?: string | null;
  /** null / undefined = all locations in company */
  locationId?: string | null;
  locationName?: string | null;
};

/**
 * Gym staff → their companyId.
 * SUPER_ADMIN → must have selected a gym (activeCompanyId → companyId on request).
 */
export function requireCompanyId(user?: TenantRequestUser | null): string {
  if (!user) {
    throw new ForbiddenException('Not authenticated');
  }

  if (user.role === Role.SUPER_ADMIN) {
    if (!user.companyId) {
      throw new BadRequestException(
        'Select a gym company first (SUPER_ADMIN active company required)',
      );
    }
    return user.companyId;
  }

  if (!user.companyId) {
    throw new ForbiddenException('User is not assigned to a company');
  }

  return user.companyId;
}

/** Optional location filter for list/read queries. Empty = all locations. */
export function locationFilter(
  user?: TenantRequestUser | null,
): { locationId?: string } {
  if (user?.locationId) {
    return { locationId: user.locationId };
  }
  return {};
}

/**
 * Writes (create member/payment/etc.) must target one location.
 * Prefer body locationId, else active session locationId.
 */
export function requireLocationIdForWrite(
  user?: TenantRequestUser | null,
  bodyLocationId?: string | null,
): string {
  const id = (bodyLocationId || user?.locationId || '').trim();
  if (!id) {
    throw new BadRequestException(
      'locationId required — select a location or pass locationId in the request',
    );
  }
  return id;
}
