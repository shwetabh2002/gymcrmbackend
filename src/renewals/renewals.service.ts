import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { RenewalFollowUpStatus } from '../common/enums/renewal-follow-up-status.enum';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
import {
  ActivityLogsService,
  ActivityActor,
} from '../activity-logs/activity-logs.service';
import { addDays, daysBetween } from '../config/time.constants';
import {
  EXPIRY_SOON_DAYS,
  EXPIRY_WINDOW_DAYS,
} from '../config/renewals.config';
import {
  buildResult,
  resolvePaging,
  PaginationQueryDto,
} from '../common/pagination/pagination';

export interface RenewalQueueQuery {
  withinDays?: number;
  includeExpired?: boolean;
  expiredWithinDays?: number;
  status?: RenewalFollowUpStatus | 'OPEN' | 'ALL';
  locationId?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class RenewalsService {
  constructor(
    @InjectModel(MemberSubscription.name)
    private readonly memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    private readonly activityLogsService: ActivityLogsService,
  ) {}

  private buildFilter(
    companyId: string,
    query: RenewalQueueQuery,
  ): Record<string, unknown> {
    const withinDays = Number(query.withinDays ?? EXPIRY_SOON_DAYS);
    const includeExpired = query.includeExpired !== false;
    const expiredWithinDays = Number(
      query.expiredWithinDays ?? EXPIRY_WINDOW_DAYS,
    );
    const statusFilter = query.status ?? 'OPEN';

    const now = new Date();
    const future = addDays(now, withinDays);
    const past = addDays(now, -expiredWithinDays);

    const orConditions: Record<string, unknown>[] = [
      {
        subscriptionStatus: {
          $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRING_SOON],
        },
        expiryDate: { $gte: now, $lte: future },
      },
    ];

    if (includeExpired) {
      orConditions.push({
        subscriptionStatus: SubscriptionStatus.EXPIRED,
        expiryDate: { $gte: past, $lte: now },
      });
      orConditions.push({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        expiryDate: { $gte: past, $lt: now },
      });
    }

    const filter: Record<string, unknown> = {
      companyId,
      $or: orConditions,
    };
    if (query.locationId) {
      filter.locationId = query.locationId;
    }

    if (statusFilter === 'OPEN') {
      filter.$and = [
        { $or: orConditions },
        {
          $or: [
            { renewalFollowUpStatus: { $exists: false } },
            { renewalFollowUpStatus: null },
            {
              renewalFollowUpStatus: {
                $in: [
                  RenewalFollowUpStatus.PENDING,
                  RenewalFollowUpStatus.CONTACTED,
                  RenewalFollowUpStatus.PROMISED,
                ],
              },
            },
          ],
        },
      ];
      delete filter.$or;
    } else if (statusFilter === RenewalFollowUpStatus.PENDING) {
      filter.$and = [
        { $or: orConditions },
        {
          $or: [
            { renewalFollowUpStatus: { $exists: false } },
            { renewalFollowUpStatus: null },
            { renewalFollowUpStatus: RenewalFollowUpStatus.PENDING },
          ],
        },
      ];
      delete filter.$or;
    } else if (statusFilter !== 'ALL') {
      filter.renewalFollowUpStatus = statusFilter;
    }

    return filter;
  }

  async getQueue(companyId: string, query: RenewalQueueQuery = {}) {
    const filter = this.buildFilter(companyId, query);
    const pagingQuery: PaginationQueryDto = {
      page: query.page ?? 1,
      limit: query.limit ?? 50,
    };
    const { skip, limit } = resolvePaging(pagingQuery);
    const now = new Date();

    const [total, rows] = await Promise.all([
      this.memberSubscriptionModel.countDocuments(filter).exec(),
      this.memberSubscriptionModel
        .find(filter)
        .populate('memberId', 'name email phone')
        .populate('planId', 'name price')
        .sort({ expiryDate: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    return buildResult(
      rows.map((sub: any) => this.toQueueItem(sub, now)),
      total,
      pagingQuery,
    );
  }

  async getCounts(
    companyId: string,
    withinDays = EXPIRY_SOON_DAYS,
    expiredWithinDays = EXPIRY_WINDOW_DAYS,
    locScope: { locationId?: string } = {},
  ) {
    const filter = this.buildFilter(companyId, {
      withinDays,
      includeExpired: true,
      expiredWithinDays,
      status: 'ALL',
      ...locScope,
    });
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const openStatuses = [
      RenewalFollowUpStatus.PENDING,
      RenewalFollowUpStatus.CONTACTED,
      RenewalFollowUpStatus.PROMISED,
    ];

    const [facet] = await this.memberSubscriptionModel
      .aggregate([
        { $match: filter },
        {
          $addFields: {
            followUp: {
              $ifNull: [
                '$renewalFollowUpStatus',
                RenewalFollowUpStatus.PENDING,
              ],
            },
          },
        },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  totalPendingAmount: { $sum: '$pendingAmount' },
                },
              },
            ],
            byStatus: [
              {
                $group: {
                  _id: '$followUp',
                  n: { $sum: 1 },
                },
              },
            ],
            expired: [
              { $match: { expiryDate: { $lt: startOfDay } } },
              { $count: 'n' },
            ],
            expiringToday: [
              {
                $match: {
                  expiryDate: { $gte: startOfDay, $lte: endOfDay },
                },
              },
              { $count: 'n' },
            ],
            open: [
              { $match: { followUp: { $in: openStatuses } } },
              { $count: 'n' },
            ],
          },
        },
      ])
      .exec();

    const byStatus: Record<string, number> = {};
    for (const row of facet?.byStatus ?? []) {
      byStatus[row._id] = row.n;
    }
    const totals = facet?.totals?.[0] ?? {};

    return {
      total: totals.total ?? 0,
      open: facet?.open?.[0]?.n ?? 0,
      pending: byStatus[RenewalFollowUpStatus.PENDING] ?? 0,
      contacted: byStatus[RenewalFollowUpStatus.CONTACTED] ?? 0,
      promised: byStatus[RenewalFollowUpStatus.PROMISED] ?? 0,
      renewed: byStatus[RenewalFollowUpStatus.RENEWED] ?? 0,
      lost: byStatus[RenewalFollowUpStatus.LOST] ?? 0,
      skipped: byStatus[RenewalFollowUpStatus.SKIPPED] ?? 0,
      expiringToday: facet?.expiringToday?.[0]?.n ?? 0,
      expired: facet?.expired?.[0]?.n ?? 0,
      totalPendingAmount: totals.totalPendingAmount ?? 0,
    };
  }

  async updateFollowUp(
    companyId: string,
    subscriptionId: string,
    dto: UpdateFollowUpDto,
    actor?: ActivityActor,
  ) {
    const sub = await this.memberSubscriptionModel.findOne({
      _id: subscriptionId,
      companyId,
    });
    if (!sub) {
      throw new NotFoundException('Subscription not found');
    }

    if (dto.renewalFollowUpStatus !== undefined) {
      sub.renewalFollowUpStatus = dto.renewalFollowUpStatus;
      sub.lastFollowUpAt = new Date();
    }
    if (dto.followUpNotes !== undefined) {
      sub.followUpNotes = dto.followUpNotes;
      if (dto.renewalFollowUpStatus === undefined) {
        sub.lastFollowUpAt = new Date();
      }
    }
    if (dto.followUpNextActionAt !== undefined) {
      sub.followUpNextActionAt = new Date(dto.followUpNextActionAt);
    }
    if (actor) {
      sub.lastFollowUpById = actor.userId as any;
      sub.lastFollowUpByName = actor.name;
    }

    await sub.save();

    const populated = await this.memberSubscriptionModel
      .findOne({ _id: sub._id, companyId })
      .populate('memberId', 'name email phone')
      .populate('planId', 'name price')
      .exec();

    const item = this.toQueueItem(populated, new Date());

    if (actor) {
      await this.activityLogsService.log({
        companyId,
        locationId: sub.locationId ? String(sub.locationId) : null,
        actor,
        action: 'RENEWAL_FOLLOW_UP',
        entityType: 'subscription',
        entityId: subscriptionId,
        summary: `${actor.name} marked ${item.memberName} as ${item.renewalFollowUpStatus}`,
        metadata: {
          status: item.renewalFollowUpStatus,
          notes: item.followUpNotes,
        },
      });
    }

    return item;
  }

  private toQueueItem(sub: any, now: Date) {
    const member = sub?.memberId;
    const plan = sub?.planId;
    const expiry = new Date(sub.expiryDate);
    const daysRemaining = daysBetween(now, expiry);

    return {
      _id: String(sub._id),
      memberId: String(member?._id ?? member ?? ''),
      memberName: member?.name || 'Unknown',
      phone: member?.phone || '',
      email: member?.email || '',
      planId: String(plan?._id ?? plan ?? ''),
      planName: plan?.name || 'Unknown Plan',
      planPrice: sub.planPrice,
      expiryDate: sub.expiryDate,
      daysRemaining,
      pendingAmount: sub.pendingAmount ?? 0,
      paymentStatus: sub.paymentStatus,
      subscriptionStatus: sub.subscriptionStatus,
      renewalFollowUpStatus:
        sub.renewalFollowUpStatus || RenewalFollowUpStatus.PENDING,
      lastFollowUpAt: sub.lastFollowUpAt ?? null,
      lastFollowUpByName: sub.lastFollowUpByName ?? null,
      followUpNotes: sub.followUpNotes ?? '',
      followUpNextActionAt: sub.followUpNextActionAt ?? null,
    };
  }
}
