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

export interface RenewalQueueQuery {
  withinDays?: number;
  includeExpired?: boolean;
  expiredWithinDays?: number;
  status?: RenewalFollowUpStatus | 'OPEN' | 'ALL';
  locationId?: string;
}

@Injectable()
export class RenewalsService {
  constructor(
    @InjectModel(MemberSubscription.name)
    private readonly memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    private readonly activityLogsService: ActivityLogsService,
  ) {}

  async getQueue(companyId: string, query: RenewalQueueQuery = {}) {
    const withinDays = Number(query.withinDays ?? 7);
    const includeExpired = query.includeExpired !== false;
    const expiredWithinDays = Number(query.expiredWithinDays ?? 30);
    const statusFilter = query.status ?? 'OPEN';

    const now = new Date();
    const future = new Date(now);
    future.setDate(future.getDate() + withinDays);

    const past = new Date(now);
    past.setDate(past.getDate() - expiredWithinDays);

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

    const rows = await this.memberSubscriptionModel
      .find(filter)
      .populate('memberId', 'name email phone')
      .populate('planId', 'name price')
      .sort({ expiryDate: 1 })
      .exec();

    return rows.map((sub: any) => this.toQueueItem(sub, now));
  }

  async getCounts(
    companyId: string,
    withinDays = 7,
    expiredWithinDays = 30,
    locScope: { locationId?: string } = {},
  ) {
    const items = await this.getQueue(companyId, {
      withinDays,
      includeExpired: true,
      expiredWithinDays,
      status: 'ALL',
      ...locScope,
    });

    const counts = {
      total: items.length,
      open: 0,
      pending: 0,
      contacted: 0,
      promised: 0,
      renewed: 0,
      lost: 0,
      skipped: 0,
      expiringToday: 0,
      expired: 0,
      totalPendingAmount: 0,
    };

    for (const item of items) {
      counts.totalPendingAmount += item.pendingAmount || 0;
      if (item.daysRemaining <= 0) counts.expired += 1;
      if (item.daysRemaining === 0) counts.expiringToday += 1;

      switch (item.renewalFollowUpStatus) {
        case RenewalFollowUpStatus.PENDING:
          counts.pending += 1;
          counts.open += 1;
          break;
        case RenewalFollowUpStatus.CONTACTED:
          counts.contacted += 1;
          counts.open += 1;
          break;
        case RenewalFollowUpStatus.PROMISED:
          counts.promised += 1;
          counts.open += 1;
          break;
        case RenewalFollowUpStatus.RENEWED:
          counts.renewed += 1;
          break;
        case RenewalFollowUpStatus.LOST:
          counts.lost += 1;
          break;
        case RenewalFollowUpStatus.SKIPPED:
          counts.skipped += 1;
          break;
      }
    }

    return counts;
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
    const daysRemaining = Math.ceil(
      (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

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
