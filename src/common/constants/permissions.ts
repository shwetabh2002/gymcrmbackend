import { Role } from '../enums/role.enum';
import {
  ALL_PERMISSIONS,
  LEGACY_PERMISSION_EXPAND,
  Permission,
} from '../enums/permission.enum';

const STAFF_DEFAULTS: Permission[] = [Permission.DASHBOARD];

const TRAINER_DEFAULTS: Permission[] = [
  Permission.DASHBOARD,
  Permission.MEMBERS_VIEW,
  Permission.RENEWALS_VIEW,
  Permission.RENEWALS_UPDATE,
  Permission.SUBSCRIPTIONS_VIEW,
  Permission.PLANS_VIEW,
];

const SALES_DEFAULTS: Permission[] = [
  Permission.DASHBOARD,
  Permission.MEMBERS_VIEW,
  Permission.MEMBERS_CREATE,
  Permission.MEMBERS_UPDATE,
  Permission.RENEWALS_VIEW,
  Permission.RENEWALS_CREATE,
  Permission.RENEWALS_UPDATE,
  Permission.SUBSCRIPTIONS_VIEW,
  Permission.SUBSCRIPTIONS_CREATE,
  Permission.SUBSCRIPTIONS_UPDATE,
  Permission.PLANS_VIEW,
  Permission.PAYMENTS_VIEW,
  Permission.PAYMENTS_CREATE,
  Permission.INVOICES_VIEW,
  Permission.INVOICES_CREATE,
];

/** Expand legacy coarse keys and keep only known Permission values. */
export function normalizePermissions(
  list?: string[] | Permission[] | null,
): Permission[] {
  if (!list?.length) return [];
  const allowed = new Set<string>(Object.values(Permission));
  const out = new Set<Permission>();
  const raw = list.map((p) => String(p));
  const isLegacy = raw.some((k) => k in LEGACY_PERMISSION_EXPAND);

  for (const key of raw) {
    const expanded = LEGACY_PERMISSION_EXPAND[key];
    if (expanded) {
      for (const p of expanded) out.add(p);
      continue;
    }
    if (allowed.has(key)) out.add(key as Permission);
  }

  // Pre-CRUD data: members_create also meant edit
  if (isLegacy && out.has(Permission.MEMBERS_CREATE)) {
    out.add(Permission.MEMBERS_UPDATE);
  }

  return [...out];
}

export function defaultPermissionsForRole(role: Role | string): Permission[] {
  if (
    role === Role.SUPER_ADMIN ||
    role === Role.ADMIN ||
    role === Role.MANAGER
  ) {
    return [...ALL_PERMISSIONS];
  }
  if (role === Role.STAFF) return [...STAFF_DEFAULTS];
  if (role === Role.TRAINER) return [...TRAINER_DEFAULTS];
  if (role === Role.SALES) return [...SALES_DEFAULTS];
  return [];
}

/**
 * null/undefined customPermissions → role defaults.
 * Array (even empty) → explicit custom set (admin tuned this employee).
 */
export function getEffectivePermissions(
  role: Role | string,
  customPermissions?: string[] | null,
): Permission[] {
  if (
    role === Role.SUPER_ADMIN ||
    role === Role.ADMIN ||
    role === Role.MANAGER
  ) {
    return [...ALL_PERMISSIONS];
  }

  if (customPermissions != null) {
    return normalizePermissions(customPermissions);
  }

  return defaultPermissionsForRole(role);
}

export function hasPermission(
  effective: Permission[] | string[],
  required: Permission | Permission[],
): boolean {
  const need = Array.isArray(required) ? required : [required];
  const set = new Set(effective);
  return need.some((p) => set.has(p));
}
