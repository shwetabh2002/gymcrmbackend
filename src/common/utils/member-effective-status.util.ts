/**
 * Member display/filter status is driven by expiry date (not only stored flags).
 *
 * Timeline (from effective expiryDate):
 *   - until expiry day     → ACTIVE
 *   - after expiry         → EXPIRED
 *   - after expiry + 3 mo  → INACTIVE
 *
 * Manual SUSPENDED always wins. Manual INACTIVE also wins when already set.
 */

export type EffectiveMemberStatus =
  | 'ACTIVE'
  | 'EXPIRED'
  | 'INACTIVE'
  | 'SUSPENDED';

/** Months after expiry before member is treated as INACTIVE. */
export const INACTIVE_AFTER_EXPIRY_MONTHS = 3;

export function startOfTodayLocal(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Prefer last ACTIVE membership; else latest by expiryDate. */
export function getCurrentMembership(member: {
  memberships?: Array<{ status?: string; expiryDate?: Date | string | null }>;
}): any | null {
  const list = member.memberships || [];
  if (!list.length) return null;
  const actives = list.filter((m) => m.status === 'ACTIVE');
  if (actives.length) return actives[actives.length - 1];
  return [...list].sort((a, b) => {
    const ta = a.expiryDate ? new Date(a.expiryDate).getTime() : 0;
    const tb = b.expiryDate ? new Date(b.expiryDate).getTime() : 0;
    return tb - ta;
  })[0];
}

export function getEffectiveExpiryDate(member: {
  memberships?: Array<{ status?: string; expiryDate?: Date | string | null }>;
  expiryDate?: Date | string | null;
}): Date | null {
  const current = getCurrentMembership(member);
  const raw = current?.expiryDate ?? member.expiryDate ?? null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveEffectiveMemberStatus(
  member: {
    memberStatus?: string | null;
    memberships?: Array<{ status?: string; expiryDate?: Date | string | null }>;
    expiryDate?: Date | string | null;
  },
  now: Date = new Date(),
): EffectiveMemberStatus {
  const stored = (member.memberStatus || '').toUpperCase();
  if (stored === 'SUSPENDED') {
    return 'SUSPENDED';
  }
  // Explicit manual inactive still respected
  if (stored === 'INACTIVE') {
    return 'INACTIVE';
  }

  const expiry = getEffectiveExpiryDate(member);
  if (!expiry) {
    return 'ACTIVE';
  }

  const today = startOfTodayLocal(now);
  const inactiveFrom = addMonths(expiry, INACTIVE_AFTER_EXPIRY_MONTHS);

  if (inactiveFrom < today) {
    return 'INACTIVE';
  }
  if (expiry < today) {
    return 'EXPIRED';
  }

  return 'ACTIVE';
}

/**
 * Mongo $addFields stages: sets effectiveMemberStatus from expiry.
 * Call after base $match; then $match on effectiveMemberStatus if filtering.
 */
export function effectiveMemberStatusAddFieldsStages(
  now: Date = new Date(),
): any[] {
  const today = startOfTodayLocal(now);
  return [
    {
      $addFields: {
        _currentMembership: {
          $let: {
            vars: {
              list: { $ifNull: ['$memberships', []] },
            },
            in: {
              $let: {
                vars: {
                  activeList: {
                    $filter: {
                      input: '$$list',
                      as: 'm',
                      cond: { $eq: ['$$m.status', 'ACTIVE'] },
                    },
                  },
                },
                in: {
                  $cond: [
                    { $gt: [{ $size: '$$activeList' }, 0] },
                    { $arrayElemAt: ['$$activeList', -1] },
                    {
                      $arrayElemAt: [
                        {
                          $sortArray: {
                            input: '$$list',
                            sortBy: { expiryDate: -1 },
                          },
                        },
                        0,
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    {
      $addFields: {
        _effectiveExpiry: {
          $ifNull: ['$_currentMembership.expiryDate', '$expiryDate'],
        },
      },
    },
    {
      $addFields: {
        _inactiveAfter: {
          $cond: [
            { $ne: ['$_effectiveExpiry', null] },
            {
              $dateAdd: {
                startDate: '$_effectiveExpiry',
                unit: 'month',
                amount: INACTIVE_AFTER_EXPIRY_MONTHS,
              },
            },
            null,
          ],
        },
      },
    },
    {
      $addFields: {
        effectiveMemberStatus: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$memberStatus', 'SUSPENDED'] },
                then: 'SUSPENDED',
              },
              {
                case: { $eq: ['$memberStatus', 'INACTIVE'] },
                then: 'INACTIVE',
              },
              {
                case: {
                  $and: [
                    { $ne: ['$_inactiveAfter', null] },
                    { $lt: ['$_inactiveAfter', today] },
                  ],
                },
                then: 'INACTIVE',
              },
              {
                case: {
                  $and: [
                    { $ne: ['$_effectiveExpiry', null] },
                    { $lt: ['$_effectiveExpiry', today] },
                  ],
                },
                then: 'EXPIRED',
              },
            ],
            default: 'ACTIVE',
          },
        },
      },
    },
  ];
}

/** Apply computed status onto a lean member document for API responses. */
export function applyEffectiveMemberStatus<T extends Record<string, any>>(
  member: T,
  now: Date = new Date(),
): T {
  const status = resolveEffectiveMemberStatus(member, now);
  const current = getCurrentMembership(member);
  const memberships = Array.isArray(member.memberships)
    ? member.memberships.map((m: any) => {
        if (!current || String(m._id) !== String(current._id)) return m;
        if (m.status === 'CANCELLED') return m;
        // Membership row only has ACTIVE/EXPIRED/CANCELLED — map INACTIVE → EXPIRED on row
        if (status === 'EXPIRED' || status === 'INACTIVE') {
          return { ...m, status: 'EXPIRED' };
        }
        if (status === 'ACTIVE' && m.status === 'EXPIRED') {
          return { ...m, status: 'ACTIVE' };
        }
        return m;
      })
    : member.memberships;

  return {
    ...member,
    memberStatus: status,
    memberships,
  };
}
