export enum Permission {
  DASHBOARD = 'dashboard',

  MEMBERS_VIEW = 'members_view',
  MEMBERS_CREATE = 'members_create',
  MEMBERS_UPDATE = 'members_update',
  MEMBERS_DELETE = 'members_delete',

  RENEWALS_VIEW = 'renewals_view',
  RENEWALS_CREATE = 'renewals_create',
  RENEWALS_UPDATE = 'renewals_update',
  RENEWALS_DELETE = 'renewals_delete',

  SUBSCRIPTIONS_VIEW = 'subscriptions_view',
  SUBSCRIPTIONS_CREATE = 'subscriptions_create',
  SUBSCRIPTIONS_UPDATE = 'subscriptions_update',
  SUBSCRIPTIONS_DELETE = 'subscriptions_delete',

  PLANS_VIEW = 'plans_view',
  PLANS_CREATE = 'plans_create',
  PLANS_UPDATE = 'plans_update',
  PLANS_DELETE = 'plans_delete',

  PAYMENTS_VIEW = 'payments_view',
  PAYMENTS_CREATE = 'payments_create',
  PAYMENTS_UPDATE = 'payments_update',
  PAYMENTS_DELETE = 'payments_delete',

  INVOICES_VIEW = 'invoices_view',
  INVOICES_CREATE = 'invoices_create',
  INVOICES_UPDATE = 'invoices_update',
  INVOICES_DELETE = 'invoices_delete',

  EMPLOYEES_VIEW = 'employees_view',
  EMPLOYEES_CREATE = 'employees_create',
  EMPLOYEES_UPDATE = 'employees_update',
  EMPLOYEES_DELETE = 'employees_delete',

  SETTINGS_VIEW = 'settings_view',
  SETTINGS_CREATE = 'settings_create',
  SETTINGS_UPDATE = 'settings_update',
  SETTINGS_DELETE = 'settings_delete',

  LOCATIONS_VIEW = 'locations_view',
  LOCATIONS_CREATE = 'locations_create',
  LOCATIONS_UPDATE = 'locations_update',
  LOCATIONS_DELETE = 'locations_delete',
}

export const ALL_PERMISSIONS: Permission[] = Object.values(Permission);

export const PERMISSION_LABELS: Record<Permission, string> = {
  [Permission.DASHBOARD]: 'Dashboard',

  [Permission.MEMBERS_VIEW]: 'View members',
  [Permission.MEMBERS_CREATE]: 'Create members',
  [Permission.MEMBERS_UPDATE]: 'Update members',
  [Permission.MEMBERS_DELETE]: 'Delete members',

  [Permission.RENEWALS_VIEW]: 'View renewals',
  [Permission.RENEWALS_CREATE]: 'Create renewals',
  [Permission.RENEWALS_UPDATE]: 'Update renewals',
  [Permission.RENEWALS_DELETE]: 'Delete renewals',

  [Permission.SUBSCRIPTIONS_VIEW]: 'View subscriptions',
  [Permission.SUBSCRIPTIONS_CREATE]: 'Create subscriptions',
  [Permission.SUBSCRIPTIONS_UPDATE]: 'Update subscriptions',
  [Permission.SUBSCRIPTIONS_DELETE]: 'Delete subscriptions',

  [Permission.PLANS_VIEW]: 'View plans',
  [Permission.PLANS_CREATE]: 'Create plans',
  [Permission.PLANS_UPDATE]: 'Update plans',
  [Permission.PLANS_DELETE]: 'Delete plans',

  [Permission.PAYMENTS_VIEW]: 'View payments',
  [Permission.PAYMENTS_CREATE]: 'Create payments',
  [Permission.PAYMENTS_UPDATE]: 'Update payments',
  [Permission.PAYMENTS_DELETE]: 'Delete payments',

  [Permission.INVOICES_VIEW]: 'View invoices',
  [Permission.INVOICES_CREATE]: 'Create invoices',
  [Permission.INVOICES_UPDATE]: 'Update invoices',
  [Permission.INVOICES_DELETE]: 'Delete invoices',

  [Permission.EMPLOYEES_VIEW]: 'View employees',
  [Permission.EMPLOYEES_CREATE]: 'Create employees',
  [Permission.EMPLOYEES_UPDATE]: 'Update employees',
  [Permission.EMPLOYEES_DELETE]: 'Delete employees',

  [Permission.SETTINGS_VIEW]: 'View settings',
  [Permission.SETTINGS_CREATE]: 'Create settings',
  [Permission.SETTINGS_UPDATE]: 'Update settings',
  [Permission.SETTINGS_DELETE]: 'Delete settings',

  [Permission.LOCATIONS_VIEW]: 'View locations',
  [Permission.LOCATIONS_CREATE]: 'Create locations',
  [Permission.LOCATIONS_UPDATE]: 'Update locations',
  [Permission.LOCATIONS_DELETE]: 'Delete locations',
};

/** Coarse / legacy keys → full CRUD (or update) for that module. */
export const LEGACY_PERMISSION_EXPAND: Record<string, Permission[]> = {
  renewals: [
    Permission.RENEWALS_VIEW,
    Permission.RENEWALS_CREATE,
    Permission.RENEWALS_UPDATE,
    Permission.RENEWALS_DELETE,
  ],
  subscriptions: [
    Permission.SUBSCRIPTIONS_VIEW,
    Permission.SUBSCRIPTIONS_CREATE,
    Permission.SUBSCRIPTIONS_UPDATE,
    Permission.SUBSCRIPTIONS_DELETE,
  ],
  plans: [
    Permission.PLANS_VIEW,
    Permission.PLANS_CREATE,
    Permission.PLANS_UPDATE,
    Permission.PLANS_DELETE,
  ],
  payments: [
    Permission.PAYMENTS_VIEW,
    Permission.PAYMENTS_CREATE,
    Permission.PAYMENTS_UPDATE,
    Permission.PAYMENTS_DELETE,
  ],
  invoices: [
    Permission.INVOICES_VIEW,
    Permission.INVOICES_CREATE,
    Permission.INVOICES_UPDATE,
    Permission.INVOICES_DELETE,
  ],
  employees: [
    Permission.EMPLOYEES_VIEW,
    Permission.EMPLOYEES_CREATE,
    Permission.EMPLOYEES_UPDATE,
    Permission.EMPLOYEES_DELETE,
  ],
  settings: [
    Permission.SETTINGS_VIEW,
    Permission.SETTINGS_CREATE,
    Permission.SETTINGS_UPDATE,
    Permission.SETTINGS_DELETE,
  ],
  locations: [
    Permission.LOCATIONS_VIEW,
    Permission.LOCATIONS_CREATE,
    Permission.LOCATIONS_UPDATE,
    Permission.LOCATIONS_DELETE,
  ],
};
