import { Role } from '../enums/role.enum';

/** Full admin / manager access */
export const ADMIN_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.MANAGER,
];

/** Any staff who can log into the CRM (not members) */
export const ALL_STAFF_ROLES: Role[] = [
  ...ADMIN_ROLES,
  Role.STAFF,
  Role.TRAINER,
  Role.SALES,
];

/** Read members / plans / basic ops */
export const MEMBER_READ_ROLES: Role[] = [
  ...ADMIN_ROLES,
  Role.STAFF,
  Role.TRAINER,
  Role.SALES,
];

/** Create/update members, subscriptions, record payments */
export const SALES_OPS_ROLES: Role[] = [...ADMIN_ROLES, Role.SALES];

/** Renewal follow-up queue */
export const RENEWAL_OPS_ROLES: Role[] = [
  ...ADMIN_ROLES,
  Role.STAFF,
  Role.TRAINER,
  Role.SALES,
];

/** Dashboard overview (no sensitive finance for trainers) */
export const DASHBOARD_ROLES: Role[] = [
  ...ADMIN_ROLES,
  Role.STAFF,
  Role.TRAINER,
  Role.SALES,
];

/** Revenue / payment trends — admin + sales */
export const FINANCE_READ_ROLES: Role[] = [...ADMIN_ROLES, Role.SALES];
