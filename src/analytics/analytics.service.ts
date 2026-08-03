import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import { UserType } from '../common/enums/user-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { RenewalFollowUpStatus } from '../common/enums/renewal-follow-up-status.enum';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(MemberSubscription.name)
    private memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    private activityLogsService: ActivityLogsService,
  ) {}

  private cid(companyId: string) {
    return new Types.ObjectId(companyId);
  }

  /** Match filter for company (+ optional location) queries / aggregates */
  private tenantMatch(
    companyId: string,
    locScope: { locationId?: string } = {},
  ): Record<string, unknown> {
    const match: Record<string, unknown> = {
      companyId: this.cid(companyId),
    };
    if (locScope.locationId) {
      match.locationId = new Types.ObjectId(locScope.locationId);
    }
    return match;
  }

  /**
   * Get dashboard overview with key metrics and detailed lists
   */
  async getDashboardOverview(companyId: string, locScope: { locationId?: string } = {}) {
    const tenant = this.tenantMatch(companyId, locScope);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
    );
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
    );

    const [
      totalMembers,
      activeSubscriptionsCount,
      expiredSubscriptionsCount,
      revenueResult,
      monthlyRevenueResult,
      lastMonthRevenueResult,
      pendingAmountResult,
      membersWithPendingCount,
      membersNearExpiryCount,
      expiringIn30Days,
      newMembersThisMonth,
      paymentModeBreakdown,
      renewalStatusBreakdown,
      activityFeed,
      activeMembers,
      membersNearExpiry,
      membersWithPendingPayments,
      recentPayments,
      newMembers,
    ] = await Promise.all([
      this.userModel
        .countDocuments({ ...tenant, userType: UserType.MEMBER })
        .exec(),
      this.memberSubscriptionModel
        .countDocuments({
          ...tenant,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
        })
        .exec(),
      this.memberSubscriptionModel
        .countDocuments({
          ...tenant,
          subscriptionStatus: SubscriptionStatus.EXPIRED,
        })
        .exec(),
      this.paymentModel.aggregate([
        { $match: { ...tenant, deletedAt: null } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.paymentModel.aggregate([
        {
          $match: {
            ...tenant,
            deletedAt: null,
            paymentDate: { $gte: startOfMonth },
          },
        },
        {
          $group: {
            _id: null,
            monthlyRevenue: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.paymentModel.aggregate([
        {
          $match: {
            ...tenant,
            deletedAt: null,
            paymentDate: { $gte: startOfLastMonth, $lte: endOfLastMonth },
          },
        },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.memberSubscriptionModel.aggregate([
        {
          $match: {
            ...tenant,
            subscriptionStatus: { $ne: SubscriptionStatus.CANCELLED },
          },
        },
        {
          $group: {
            _id: null,
            totalPending: { $sum: '$pendingAmount' },
          },
        },
      ]),
      this.memberSubscriptionModel
        .countDocuments({
          ...tenant,
          subscriptionStatus: { $ne: SubscriptionStatus.CANCELLED },
          pendingAmount: { $gt: 0 },
        })
        .exec(),
      this.memberSubscriptionModel
        .countDocuments({
          ...tenant,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          expiryDate: { $gte: now, $lte: sevenDaysFromNow },
        })
        .exec(),
      this.memberSubscriptionModel
        .countDocuments({
          ...tenant,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          expiryDate: { $gte: now, $lte: thirtyDaysFromNow },
        })
        .exec(),
      this.userModel
        .countDocuments({
          ...tenant,
          userType: UserType.MEMBER,
          createdAt: { $gte: startOfMonth },
        })
        .exec(),
      this.paymentModel.aggregate([
        { $match: { ...tenant, deletedAt: null } },
        {
          $group: {
            _id: '$paymentMode',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
      ]),
      this.memberSubscriptionModel.aggregate([
        {
          $match: {
            ...tenant,
            $or: [
              {
                subscriptionStatus: {
                  $in: [
                    SubscriptionStatus.ACTIVE,
                    SubscriptionStatus.EXPIRING_SOON,
                  ],
                },
                expiryDate: { $gte: now, $lte: sevenDaysFromNow },
              },
              {
                subscriptionStatus: SubscriptionStatus.EXPIRED,
                expiryDate: { $gte: thirtyDaysAgo, $lte: now },
              },
              {
                subscriptionStatus: SubscriptionStatus.ACTIVE,
                expiryDate: { $gte: thirtyDaysAgo, $lt: now },
              },
            ],
          },
        },
        {
          $group: {
            _id: {
              $ifNull: [
                '$renewalFollowUpStatus',
                RenewalFollowUpStatus.PENDING,
              ],
            },
            count: { $sum: 1 },
          },
        },
      ]),
      this.activityLogsService.findRecent(companyId, 30, locScope),
      this.memberSubscriptionModel
        .find({
          ...tenant,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
        })
        .populate('memberId', 'name email phone')
        .populate('planId', 'name price')
        .select(
          'memberId planId startDate expiryDate paymentStatus pendingAmount',
        )
        .sort({ expiryDate: 1 })
        .limit(10)
        .exec(),
      this.memberSubscriptionModel
        .find({
          ...tenant,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          expiryDate: { $gte: now, $lte: sevenDaysFromNow },
        })
        .populate('memberId', 'name email phone')
        .populate('planId', 'name price')
        .select('memberId planId expiryDate pendingAmount paymentStatus')
        .sort({ expiryDate: 1 })
        .exec(),
      this.memberSubscriptionModel
        .find({
          ...tenant,
          subscriptionStatus: { $ne: SubscriptionStatus.CANCELLED },
          pendingAmount: { $gt: 0 },
        })
        .populate('memberId', 'name email phone')
        .populate('planId', 'name price')
        .select(
          'memberId planId pendingAmount totalPaid planPrice paymentStatus',
        )
        .sort({ pendingAmount: -1 })
        .limit(10)
        .exec(),
      this.paymentModel
        .find({ ...tenant, deletedAt: null })
        .populate('memberId', 'name email')
        .populate('receivedBy', 'name email')
        .select(
          'memberId receivedBy amount paymentMode paymentDate transactionId',
        )
        .sort({ paymentDate: -1, createdAt: -1 })
        .limit(10)
        .exec(),
      this.userModel
        .find({
          ...tenant,
          userType: UserType.MEMBER,
          createdAt: { $gte: thirtyDaysAgo },
        })
        .select('name email phone createdAt')
        .sort({ createdAt: -1 })
        .limit(10)
        .exec(),
    ]);

    const totalRevenue = revenueResult[0]?.totalRevenue || 0;
    const totalPaymentsCount = revenueResult[0]?.count || 0;
    const monthlyRevenue = monthlyRevenueResult[0]?.monthlyRevenue || 0;
    const monthlyPaymentsCount = monthlyRevenueResult[0]?.count || 0;
    const lastMonthRevenue = lastMonthRevenueResult[0]?.revenue || 0;
    const lastMonthPaymentsCount = lastMonthRevenueResult[0]?.count || 0;
    const totalPendingAmount = pendingAmountResult[0]?.totalPending || 0;

    const revenueMomPct =
      lastMonthRevenue > 0
        ? Math.round(
            ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 1000,
          ) / 10
        : monthlyRevenue > 0
          ? 100
          : 0;

    const renewalsMap: Record<string, number> = {
      PENDING: 0,
      CONTACTED: 0,
      PROMISED: 0,
      RENEWED: 0,
      LOST: 0,
      SKIPPED: 0,
    };
    for (const row of renewalStatusBreakdown as any[]) {
      const key = row._id || RenewalFollowUpStatus.PENDING;
      renewalsMap[key] = (renewalsMap[key] || 0) + row.count;
    }
    const renewalsOpenCount =
      renewalsMap.PENDING + renewalsMap.CONTACTED + renewalsMap.PROMISED;

    const membersNearExpiryWithDays = membersNearExpiry.map((sub: any) => {
      const daysRemaining = Math.ceil(
        (new Date(sub.expiryDate).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      return {
        memberName: sub.memberId?.name || 'Unknown',
        email: sub.memberId?.email || '',
        phone: sub.memberId?.phone || '',
        planName: sub.planId?.name || 'Unknown Plan',
        expiryDate: sub.expiryDate,
        daysRemaining,
        pendingAmount: sub.pendingAmount,
        paymentStatus: sub.paymentStatus,
      };
    });

    return {
      counts: {
        totalMembers,
        activeSubscriptions: activeSubscriptionsCount,
        expiredSubscriptions: expiredSubscriptionsCount,
        totalRevenue,
        totalPaymentsCount,
        monthlyRevenue,
        monthlyPaymentsCount,
        lastMonthRevenue,
        lastMonthPaymentsCount,
        revenueMomPct,
        totalPendingAmount,
        membersNearExpiry: membersNearExpiryCount,
        membersExpiringIn30Days: expiringIn30Days,
        membersWithPendingPayments: membersWithPendingCount,
        newMembersThisMonth,
        renewalsOpen: renewalsOpenCount,
        renewalsContacted: renewalsMap.CONTACTED,
        renewalsPromised: renewalsMap.PROMISED,
        renewalsRenewed: renewalsMap.RENEWED,
        renewalsLost: renewalsMap.LOST,
      },

      paymentModeBreakdown: (paymentModeBreakdown as any[]).map((row) => ({
        mode: row._id || 'UNKNOWN',
        total: row.total,
        count: row.count,
      })),

      renewalsBreakdown: renewalsMap,

      activeMembers: activeMembers.map((sub: any) => ({
        memberName: sub.memberId?.name || 'Unknown',
        email: sub.memberId?.email || '',
        phone: sub.memberId?.phone || '',
        planName: sub.planId?.name || 'Unknown Plan',
        planPrice: sub.planId?.price || 0,
        startDate: sub.startDate,
        expiryDate: sub.expiryDate,
        paymentStatus: sub.paymentStatus,
        pendingAmount: sub.pendingAmount,
      })),

      membersNearExpiry: membersNearExpiryWithDays,

      membersWithPendingPayments: membersWithPendingPayments.map(
        (sub: any) => ({
          memberName: sub.memberId?.name || 'Unknown',
          email: sub.memberId?.email || '',
          phone: sub.memberId?.phone || '',
          planName: sub.planId?.name || 'Unknown Plan',
          planPrice: sub.planPrice,
          totalPaid: sub.totalPaid,
          pendingAmount: sub.pendingAmount,
          paymentStatus: sub.paymentStatus,
        }),
      ),

      recentPayments: recentPayments.map((payment: any) => ({
        memberName: payment.memberId?.name || 'Unknown',
        email: payment.memberId?.email || '',
        amount: payment.amount,
        paymentMode: payment.paymentMode,
        paymentDate: payment.paymentDate,
        transactionId: payment.transactionId,
        receivedByName: payment.receivedBy?.name || null,
      })),

      newMembers: newMembers.map((member: any) => ({
        name: member.name,
        email: member.email,
        phone: member.phone,
        joinedDate: member.createdAt,
      })),

      activityFeed: (activityFeed as any[]).map((a) => ({
        id: String(a._id),
        actorName: a.actorName,
        actorId: a.actorId ? String(a.actorId) : null,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId ? String(a.entityId) : null,
        summary: a.summary,
        metadata: a.metadata || {},
        createdAt: a.createdAt,
      })),
    };
  }

  /**
   * Get member statistics
   */
  async getMemberStatistics(companyId: string, locScope: { locationId?: string } = {}) {
    const tenant = this.tenantMatch(companyId, locScope);
    const totalMembers = await this.userModel
      .countDocuments({ ...tenant, userType: UserType.MEMBER })
      .exec();

    const membersWithActiveSubscriptions = await this.memberSubscriptionModel
      .distinct('memberId', {
        ...tenant,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      })
      .exec();

    const membersWithExpiredSubscriptions = await this.memberSubscriptionModel
      .distinct('memberId', {
        ...tenant,
        subscriptionStatus: SubscriptionStatus.EXPIRED,
      })
      .exec();

    const membersWithSubscriptions = await this.memberSubscriptionModel
      .distinct('memberId', { ...tenant })
      .exec();

    const membersWithoutSubscription =
      totalMembers - membersWithSubscriptions.length;

    return {
      totalMembers,
      membersWithActiveSubscriptions: membersWithActiveSubscriptions.length,
      membersWithExpiredSubscriptions: membersWithExpiredSubscriptions.length,
      membersWithoutSubscription,
    };
  }

  /**
   * Get revenue analytics
   */
  async getRevenueAnalytics(companyId: string, locScope: { locationId?: string } = {}) {
    const tenant = this.tenantMatch(companyId, locScope);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const totalRevenueResult = await this.paymentModel.aggregate([
      { $match: { ...tenant, deletedAt: null } },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
        },
      },
    ]);
    const totalRevenue = totalRevenueResult[0]?.total || 0;

    const currentMonthResult = await this.paymentModel.aggregate([
      {
        $match: {
          ...tenant,
          deletedAt: null,
          paymentDate: { $gte: startOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);
    const currentMonthRevenue = currentMonthResult[0]?.total || 0;
    const currentMonthPayments = currentMonthResult[0]?.count || 0;

    const lastMonthResult = await this.paymentModel.aggregate([
      {
        $match: {
          ...tenant,
          deletedAt: null,
          paymentDate: { $gte: startOfLastMonth, $lte: endOfLastMonth },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);
    const lastMonthRevenue = lastMonthResult[0]?.total || 0;
    const lastMonthPayments = lastMonthResult[0]?.count || 0;

    const pendingAmountResult = await this.memberSubscriptionModel.aggregate([
      {
        $match: {
          ...tenant,
          subscriptionStatus: { $ne: SubscriptionStatus.CANCELLED },
          pendingAmount: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$pendingAmount' },
          count: { $sum: 1 },
        },
      },
    ]);
    const totalPendingAmount = pendingAmountResult[0]?.total || 0;
    const subscriptionsWithPending = pendingAmountResult[0]?.count || 0;

    const paymentModeBreakdown = await this.paymentModel.aggregate([
      { $match: { ...tenant, deletedAt: null } },
      {
        $group: {
          _id: '$paymentMode',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { total: -1 },
      },
    ]);

    return {
      totalRevenue,
      currentMonth: {
        revenue: currentMonthRevenue,
        payments: currentMonthPayments,
      },
      lastMonth: {
        revenue: lastMonthRevenue,
        payments: lastMonthPayments,
      },
      pending: {
        amount: totalPendingAmount,
        subscriptions: subscriptionsWithPending,
      },
      paymentModeBreakdown,
    };
  }

  /**
   * Get subscription analytics
   */
  async getSubscriptionAnalytics(companyId: string, locScope: { locationId?: string } = {}) {
    const tenant = this.tenantMatch(companyId, locScope);
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
    );

    const totalSubscriptions = await this.memberSubscriptionModel
      .countDocuments({ ...tenant })
      .exec();

    const statusBreakdown = await this.memberSubscriptionModel.aggregate([
      { $match: { ...tenant } },
      {
        $group: {
          _id: '$subscriptionStatus',
          count: { $sum: 1 },
        },
      },
    ]);

    const paymentStatusBreakdown = await this.memberSubscriptionModel.aggregate(
      [
        {
          $match: {
            ...tenant,
            subscriptionStatus: { $ne: SubscriptionStatus.CANCELLED },
          },
        },
        {
          $group: {
            _id: '$paymentStatus',
            count: { $sum: 1 },
            totalPending: { $sum: '$pendingAmount' },
          },
        },
      ],
    );

    const expiringSoon = await this.memberSubscriptionModel
      .find({
        ...tenant,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        expiryDate: { $gte: now, $lte: sevenDaysFromNow },
      })
      .populate('memberId', 'name email phone')
      .populate('planId', 'name')
      .select('memberId planId expiryDate pendingAmount')
      .sort({ expiryDate: 1 })
      .exec();

    const expiringInMonth = await this.memberSubscriptionModel
      .countDocuments({
        ...tenant,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        expiryDate: { $gte: now, $lte: thirtyDaysFromNow },
      })
      .exec();

    const popularPlans = await this.memberSubscriptionModel.aggregate([
      {
        $match: {
          ...tenant,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
        },
      },
      {
        $group: {
          _id: '$planId',
          count: { $sum: 1 },
        },
      },
      {
        $sort: { count: -1 },
      },
      {
        $limit: 5,
      },
      {
        $lookup: {
          from: 'subscriptionplans',
          localField: '_id',
          foreignField: '_id',
          as: 'plan',
        },
      },
      {
        $unwind: '$plan',
      },
      {
        $project: {
          planName: '$plan.name',
          price: '$plan.price',
          activeSubscriptions: '$count',
        },
      },
    ]);

    return {
      totalSubscriptions,
      statusBreakdown,
      paymentStatusBreakdown,
      expiringSoon: {
        count: expiringSoon.length,
        list: expiringSoon,
      },
      expiringInMonth,
      popularPlans,
    };
  }

  /**
   * Get payment trends (last 6 months)
   */
  async getPaymentTrends(companyId: string, locScope: { locationId?: string } = {}) {
    const tenant = this.tenantMatch(companyId, locScope);
    const now = new Date();
    const sixMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 5,
      1,
    );

    const monthlyTrends = await this.paymentModel.aggregate([
      {
        $match: {
          ...tenant,
          deletedAt: null,
          paymentDate: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$paymentDate' },
            month: { $month: '$paymentDate' },
          },
          revenue: { $sum: '$amount' },
          payments: { $sum: 1 },
        },
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 },
      },
      {
        $project: {
          _id: 0,
          year: '$_id.year',
          month: '$_id.month',
          revenue: 1,
          payments: 1,
        },
      },
    ]);

    return {
      monthlyTrends,
    };
  }
}
