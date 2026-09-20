import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UserType } from '../common/enums/user-type.enum';
import { daysBetween } from '../config/time.constants';
import {
  buildResult,
  resolvePaging,
  searchRegex,
  PaginationQueryDto,
} from '../common/pagination/pagination';

export type DuesSort =
  | 'reminder_asc'
  | 'reminder_desc'
  | 'pending_desc'
  | 'pending_asc'
  | 'name_asc'
  | 'expiry_asc';

@Injectable()
export class DuesService {
  constructor(
    @InjectModel(MemberSubscription.name)
    private readonly memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Partial / unpaid balances — paged + Mongo sort; counts via aggregation.
   */
  async getQueue(
    companyId: string,
    opts: {
      locationId?: string;
      sort?: DuesSort;
      search?: string;
      page?: number;
      limit?: number;
      reminder?: 'ALL' | 'SET' | 'OVERDUE' | 'NONE';
    } = {},
  ) {
    const filter: Record<string, unknown> = {
      companyId,
      pendingAmount: { $gt: 0 },
    };
    if (opts.locationId) {
      filter.locationId = opts.locationId;
    }

    const now = new Date();
    const reminder = opts.reminder || 'ALL';
    if (reminder === 'SET') {
      filter.dueReminderDate = { $ne: null };
    } else if (reminder === 'NONE') {
      filter.dueReminderDate = null;
    } else if (reminder === 'OVERDUE') {
      filter.dueReminderDate = { $ne: null, $lt: now };
    }

    const term = searchRegex(opts.search);
    if (term) {
      const members = await this.userModel
        .find({
          companyId,
          userType: UserType.MEMBER,
          $or: [{ name: term }, { phone: term }, { idNo: term }],
        })
        .select('_id')
        .limit(300)
        .lean()
        .exec();
      const ids = members.map((m) => m._id);
      filter.memberId = { $in: ids.length ? ids : [new Types.ObjectId()] };
    }

    const counts = await this.aggregateCounts(filter, now);
    const sort = opts.sort || 'reminder_asc';
    const pagingQuery: PaginationQueryDto = {
      page: opts.page ?? 1,
      limit: opts.limit ?? 50,
    };
    const { skip, limit } = resolvePaging(pagingQuery);

    // name_asc needs member name — fetch a bounded set then sort in memory
    if (sort === 'name_asc') {
      const rows = await this.memberSubscriptionModel
        .find(filter)
        .populate('memberId', 'name phone email idNo')
        .populate('planId', 'name duration durationType')
        .lean()
        .limit(500)
        .exec();
      const mapped = rows
        .map((sub) => this.toItem(sub, now))
        .sort((a, b) => a.memberName.localeCompare(b.memberName));
      const pageItems = mapped.slice(skip, skip + limit);
      return {
        ...buildResult(pageItems, counts.total, pagingQuery),
        counts,
      };
    }

    const mongoSort = this.mongoSort(sort);
    const rows = await this.memberSubscriptionModel
      .find(filter)
      .populate('memberId', 'name phone email idNo')
      .populate('planId', 'name duration durationType')
      .sort(mongoSort)
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return {
      ...buildResult(
        rows.map((sub) => this.toItem(sub, now)),
        counts.total,
        pagingQuery,
      ),
      counts,
    };
  }

  private mongoSort(sort: DuesSort): Record<string, 1 | -1> {
    switch (sort) {
      case 'reminder_desc':
        return { dueReminderDate: -1 };
      case 'pending_desc':
        return { pendingAmount: -1 };
      case 'pending_asc':
        return { pendingAmount: 1 };
      case 'expiry_asc':
        return { expiryDate: 1 };
      case 'reminder_asc':
      default:
        return { dueReminderDate: 1 };
    }
  }

  private async aggregateCounts(
    filter: Record<string, unknown>,
    now: Date,
  ): Promise<{
    total: number;
    totalPending: number;
    withReminder: number;
    overdueReminder: number;
  }> {
    const [row] = await this.memberSubscriptionModel
      .aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            totalPending: { $sum: '$pendingAmount' },
            withReminder: {
              $sum: {
                $cond: [{ $ne: ['$dueReminderDate', null] }, 1, 0],
              },
            },
            overdueReminder: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$dueReminderDate', null] },
                      { $lt: ['$dueReminderDate', now] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .exec();

    return {
      total: row?.total ?? 0,
      totalPending: row?.totalPending ?? 0,
      withReminder: row?.withReminder ?? 0,
      overdueReminder: row?.overdueReminder ?? 0,
    };
  }

  private toItem(sub: any, now: Date) {
    const member = sub.memberId || {};
    const plan = sub.planId || {};
    const reminder = sub.dueReminderDate
      ? new Date(sub.dueReminderDate)
      : null;
    return {
      subscriptionId: String(sub._id),
      memberId: member._id ? String(member._id) : String(sub.memberId),
      memberName: member.name || 'Unknown',
      memberPhone: member.phone || null,
      memberEmail: member.email || null,
      idNo: member.idNo || null,
      planName: plan.name || null,
      planPrice: sub.planPrice,
      totalPaid: sub.totalPaid ?? 0,
      pendingAmount: sub.pendingAmount ?? 0,
      paymentStatus: sub.paymentStatus,
      dueReminderDate: reminder ? reminder.toISOString() : null,
      daysUntilReminder: reminder ? daysBetween(now, reminder) : null,
      expiryDate: sub.expiryDate
        ? new Date(sub.expiryDate).toISOString()
        : null,
      startDate: sub.startDate
        ? new Date(sub.startDate).toISOString()
        : null,
    };
  }
}
