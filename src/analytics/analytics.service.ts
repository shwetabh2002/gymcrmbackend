import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import {
  MemberPayment,
  MemberPaymentDocument,
} from '../members/schemas/member-payment.schema';
import { UserType } from '../common/enums/user-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { PaymentStatus } from '../common/enums/payment-status.enum';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(MemberSubscription.name)
    private memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(MemberPayment.name)
    private memberPaymentModel: Model<MemberPaymentDocument>,
  ) {}

  /**
   * Get dashboard overview with key metrics and detailed lists
   */
  async getDashboardOverview() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
    );

    // ===== COUNTS =====
    // Total members count
    const totalMembers = await this.userModel
      .countDocuments({ userType: UserType.MEMBER })
      .exec();

    // Active subscriptions count (detailed flow only)
    const activeSubscriptionsCount = await this.memberSubscriptionModel
      .countDocuments({ subscriptionStatus: SubscriptionStatus.ACTIVE })
      .exec();

    // Total revenue collected from BOTH flows
    // Detailed flow: Payment model
    const revenueResultDetailed = await this.paymentModel.aggregate([
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
        },
      },
    ]);
    const totalRevenueDetailed = revenueResultDetailed[0]?.totalRevenue || 0;

    // Simplified flow: MemberPayment model (use 'received' field)
    const revenueResultSimplified = await this.memberPaymentModel.aggregate([
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$received' },
        },
      },
    ]);
    const totalRevenueSimplified = revenueResultSimplified[0]?.totalRevenue || 0;

    const totalRevenue = totalRevenueDetailed + totalRevenueSimplified;

    // Monthly revenue (current month) from BOTH flows
    // Detailed flow
    const monthlyRevenueDetailedResult = await this.paymentModel.aggregate([
      {
        $match: {
          paymentDate: { $gte: startOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          monthlyRevenue: { $sum: '$amount' },
        },
      },
    ]);
    const monthlyRevenueDetailed =
      monthlyRevenueDetailedResult[0]?.monthlyRevenue || 0;

    // Simplified flow
    const monthlyRevenueSimplifiedResult =
      await this.memberPaymentModel.aggregate([
        {
          $match: {
            paymentDate: { $gte: startOfMonth },
          },
        },
        {
          $group: {
            _id: null,
            monthlyRevenue: { $sum: '$received' },
          },
        },
      ]);
    const monthlyRevenueSimplified =
      monthlyRevenueSimplifiedResult[0]?.monthlyRevenue || 0;

    const monthlyRevenue = monthlyRevenueDetailed + monthlyRevenueSimplified;

    // Pending amount from BOTH flows
    // Detailed flow: from subscriptions
    const pendingAmountDetailedResult =
      await this.memberSubscriptionModel.aggregate([
        {
          $match: {
            subscriptionStatus: { $ne: SubscriptionStatus.CANCELLED },
          },
        },
        {
          $group: {
            _id: null,
            totalPending: { $sum: '$pendingAmount' },
          },
        },
      ]);
    const totalPendingDetailed =
      pendingAmountDetailedResult[0]?.totalPending || 0;

    // Simplified flow: from MemberPayments
    const pendingAmountSimplifiedResult =
      await this.memberPaymentModel.aggregate([
        {
          $group: {
            _id: null,
            totalPending: { $sum: '$pending' },
          },
        },
      ]);
    const totalPendingSimplified =
      pendingAmountSimplifiedResult[0]?.totalPending || 0;

    const totalPendingAmount = totalPendingDetailed + totalPendingSimplified;

    // ===== DETAILED LISTS =====

    // Active members with subscription details
    const activeMembers = await this.memberSubscriptionModel
      .find({ subscriptionStatus: SubscriptionStatus.ACTIVE })
      .populate('memberId', 'name email phone')
      .populate('planId', 'name price')
      .select('memberId planId startDate expiryDate paymentStatus pendingAmount')
      .sort({ expiryDate: 1 })
      .limit(10)
      .exec();

    // Members with subscriptions expiring in next 7 days
    const membersNearExpiry = await this.memberSubscriptionModel
      .find({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        expiryDate: { $gte: now, $lte: sevenDaysFromNow },
      })
      .populate('memberId', 'name email phone')
      .populate('planId', 'name price')
      .select('memberId planId expiryDate pendingAmount paymentStatus')
      .sort({ expiryDate: 1 })
      .exec();

    // Calculate days remaining for expiring subscriptions
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

    // Members with pending/partial payments
    const membersWithPendingPayments = await this.memberSubscriptionModel
      .find({
        subscriptionStatus: { $ne: SubscriptionStatus.CANCELLED },
        pendingAmount: { $gt: 0 },
      })
      .populate('memberId', 'name email phone')
      .populate('planId', 'name price')
      .select('memberId planId pendingAmount totalPaid planPrice paymentStatus')
      .sort({ pendingAmount: -1 })
      .limit(10)
      .exec();

    // Recent payments from BOTH flows (last 10 combined)
    // Detailed flow payments
    const recentPaymentsDetailed = await this.paymentModel
      .find()
      .populate('memberId', 'name email')
      .populate('subscriptionId', 'planId')
      .select('memberId amount paymentMode paymentDate transactionId')
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(10)
      .exec();

    // Simplified flow payments
    const recentPaymentsSimplified = await this.memberPaymentModel
      .find()
      .populate('memberId', 'name email')
      .select('memberId amount received mop paymentDate transactionId')
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(10)
      .exec();

    // Combine and sort both payment types
    const allRecentPayments = [
      ...recentPaymentsDetailed.map((p: any) => ({
        memberName: p.memberId?.name || 'Unknown',
        email: p.memberId?.email || '',
        amount: p.amount,
        paymentMode: p.paymentMode,
        paymentDate: p.paymentDate,
        transactionId: p.transactionId,
        flow: 'detailed',
      })),
      ...recentPaymentsSimplified.map((p: any) => ({
        memberName: p.memberId?.name || 'Unknown',
        email: p.memberId?.email || '',
        amount: p.received,
        paymentMode: p.mop,
        paymentDate: p.paymentDate,
        transactionId: p.transactionId,
        flow: 'simplified',
      })),
    ]
      .sort((a, b) => {
        return (
          new Date(b.paymentDate).getTime() -
          new Date(a.paymentDate).getTime()
        );
      })
      .slice(0, 10);

    // New members (joined in last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const newMembers = await this.userModel
      .find({
        userType: UserType.MEMBER,
        createdAt: { $gte: thirtyDaysAgo },
      })
      .select('name email phone createdAt')
      .sort({ createdAt: -1 })
      .limit(10)
      .exec();

    return {
      // Counts
      counts: {
        totalMembers,
        activeSubscriptions: activeSubscriptionsCount,
        totalRevenue,
        monthlyRevenue,
        totalPendingAmount,
        membersNearExpiry: membersNearExpiry.length,
        membersWithPendingPayments: membersWithPendingPayments.length,
        newMembersThisMonth: newMembers.length,
      },

      // Detailed Lists
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

      recentPayments: allRecentPayments,

      newMembers: newMembers.map((member: any) => ({
        name: member.name,
        email: member.email,
        phone: member.phone,
        joinedDate: member.createdAt,
      })),
    };
  }

  /**
   * Get member statistics
   */
  async getMemberStatistics() {
    const totalMembers = await this.userModel
      .countDocuments({ userType: UserType.MEMBER })
      .exec();

    // Members with active subscriptions
    const membersWithActiveSubscriptions = await this.memberSubscriptionModel
      .distinct('memberId', {
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      })
      .exec();

    // Members with expired subscriptions
    const membersWithExpiredSubscriptions = await this.memberSubscriptionModel
      .distinct('memberId', {
        subscriptionStatus: SubscriptionStatus.EXPIRED,
      })
      .exec();

    // Members without any subscription
    const membersWithSubscriptions = await this.memberSubscriptionModel
      .distinct('memberId')
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
   * Get revenue analytics (BOTH flows combined)
   */
  async getRevenueAnalytics() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // Total revenue all time from BOTH flows
    // Detailed flow
    const totalRevenueDetailedResult = await this.paymentModel.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
        },
      },
    ]);
    const totalRevenueDetailed = totalRevenueDetailedResult[0]?.total || 0;

    // Simplified flow
    const totalRevenueSimplifiedResult =
      await this.memberPaymentModel.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: '$received' },
          },
        },
      ]);
    const totalRevenueSimplified =
      totalRevenueSimplifiedResult[0]?.total || 0;

    const totalRevenue = totalRevenueDetailed + totalRevenueSimplified;

    // Current month revenue from BOTH flows
    // Detailed flow
    const currentMonthDetailedResult = await this.paymentModel.aggregate([
      {
        $match: {
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
    const currentMonthRevenueDetailed =
      currentMonthDetailedResult[0]?.total || 0;
    const currentMonthPaymentsDetailed =
      currentMonthDetailedResult[0]?.count || 0;

    // Simplified flow
    const currentMonthSimplifiedResult =
      await this.memberPaymentModel.aggregate([
        {
          $match: {
            paymentDate: { $gte: startOfMonth },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$received' },
            count: { $sum: 1 },
          },
        },
      ]);
    const currentMonthRevenueSimplified =
      currentMonthSimplifiedResult[0]?.total || 0;
    const currentMonthPaymentsSimplified =
      currentMonthSimplifiedResult[0]?.count || 0;

    const currentMonthRevenue =
      currentMonthRevenueDetailed + currentMonthRevenueSimplified;
    const currentMonthPayments =
      currentMonthPaymentsDetailed + currentMonthPaymentsSimplified;

    // Last month revenue from BOTH flows
    // Detailed flow
    const lastMonthDetailedResult = await this.paymentModel.aggregate([
      {
        $match: {
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
    const lastMonthRevenueDetailed = lastMonthDetailedResult[0]?.total || 0;
    const lastMonthPaymentsDetailed = lastMonthDetailedResult[0]?.count || 0;

    // Simplified flow
    const lastMonthSimplifiedResult =
      await this.memberPaymentModel.aggregate([
        {
          $match: {
            paymentDate: { $gte: startOfLastMonth, $lte: endOfLastMonth },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$received' },
            count: { $sum: 1 },
          },
        },
      ]);
    const lastMonthRevenueSimplified =
      lastMonthSimplifiedResult[0]?.total || 0;
    const lastMonthPaymentsSimplified =
      lastMonthSimplifiedResult[0]?.count || 0;

    const lastMonthRevenue =
      lastMonthRevenueDetailed + lastMonthRevenueSimplified;
    const lastMonthPayments =
      lastMonthPaymentsDetailed + lastMonthPaymentsSimplified;

    // Total pending amount from BOTH flows
    // Detailed flow: from subscriptions
    const pendingAmountDetailedResult =
      await this.memberSubscriptionModel.aggregate([
        {
          $match: {
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
    const totalPendingDetailed = pendingAmountDetailedResult[0]?.total || 0;
    const subscriptionsWithPendingDetailed =
      pendingAmountDetailedResult[0]?.count || 0;

    // Simplified flow: from MemberPayments
    const pendingAmountSimplifiedResult =
      await this.memberPaymentModel.aggregate([
        {
          $match: {
            pending: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$pending' },
            count: { $sum: 1 },
          },
        },
      ]);
    const totalPendingSimplified =
      pendingAmountSimplifiedResult[0]?.total || 0;
    const paymentsWithPendingSimplified =
      pendingAmountSimplifiedResult[0]?.count || 0;

    const totalPendingAmount = totalPendingDetailed + totalPendingSimplified;
    const totalWithPending =
      subscriptionsWithPendingDetailed + paymentsWithPendingSimplified;

    // Payment mode breakdown from BOTH flows
    // Detailed flow
    const paymentModeBreakdownDetailed = await this.paymentModel.aggregate([
      {
        $group: {
          _id: '$paymentMode',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    // Simplified flow
    const paymentModeBreakdownSimplified =
      await this.memberPaymentModel.aggregate([
        {
          $group: {
            _id: '$mop',
            total: { $sum: '$received' },
            count: { $sum: 1 },
          },
        },
      ]);

    // Combine and aggregate payment mode breakdowns
    const paymentModeMap = new Map();

    paymentModeBreakdownDetailed.forEach((item) => {
      const mode = item._id?.toUpperCase() || 'UNKNOWN';
      paymentModeMap.set(mode, {
        _id: mode,
        total: (paymentModeMap.get(mode)?.total || 0) + (item.total || 0),
        count: (paymentModeMap.get(mode)?.count || 0) + (item.count || 0),
      });
    });

    paymentModeBreakdownSimplified.forEach((item) => {
      const mode = item._id?.toUpperCase() || 'UNKNOWN';
      paymentModeMap.set(mode, {
        _id: mode,
        total: (paymentModeMap.get(mode)?.total || 0) + (item.total || 0),
        count: (paymentModeMap.get(mode)?.count || 0) + (item.count || 0),
      });
    });

    const paymentModeBreakdown = Array.from(paymentModeMap.values()).sort(
      (a, b) => b.total - a.total,
    );

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
        subscriptions: totalWithPending,
      },
      paymentModeBreakdown,
    };
  }

  /**
   * Get subscription analytics
   */
  async getSubscriptionAnalytics() {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
    );

    // Total subscriptions count
    const totalSubscriptions = await this.memberSubscriptionModel
      .countDocuments()
      .exec();

    // Status breakdown
    const statusBreakdown = await this.memberSubscriptionModel.aggregate([
      {
        $group: {
          _id: '$subscriptionStatus',
          count: { $sum: 1 },
        },
      },
    ]);

    // Payment status breakdown
    const paymentStatusBreakdown = await this.memberSubscriptionModel.aggregate(
      [
        {
          $match: {
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

    // Expiring soon (next 7 days)
    const expiringSoon = await this.memberSubscriptionModel
      .find({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        expiryDate: { $gte: now, $lte: sevenDaysFromNow },
      })
      .populate('memberId', 'name email phone')
      .populate('planId', 'name')
      .select('memberId planId expiryDate pendingAmount')
      .sort({ expiryDate: 1 })
      .exec();

    // Expiring in next 30 days
    const expiringInMonth = await this.memberSubscriptionModel
      .countDocuments({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        expiryDate: { $gte: now, $lte: thirtyDaysFromNow },
      })
      .exec();

    // Most popular plans
    const popularPlans = await this.memberSubscriptionModel.aggregate([
      {
        $match: {
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
   * Get payment trends (last 6 months) from BOTH flows
   */
  async getPaymentTrends() {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // Detailed flow trends
    const monthlyTrendsDetailed = await this.paymentModel.aggregate([
      {
        $match: {
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

    // Simplified flow trends
    const monthlyTrendsSimplified = await this.memberPaymentModel.aggregate([
      {
        $match: {
          paymentDate: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$paymentDate' },
            month: { $month: '$paymentDate' },
          },
          revenue: { $sum: '$received' },
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

    // Combine both flow trends by month
    const trendsMap = new Map();

    monthlyTrendsDetailed.forEach((trend) => {
      const key = `${trend.year}-${trend.month}`;
      trendsMap.set(key, {
        year: trend.year,
        month: trend.month,
        revenue: trend.revenue,
        payments: trend.payments,
      });
    });

    monthlyTrendsSimplified.forEach((trend) => {
      const key = `${trend.year}-${trend.month}`;
      const existing = trendsMap.get(key);
      if (existing) {
        existing.revenue += trend.revenue;
        existing.payments += trend.payments;
      } else {
        trendsMap.set(key, {
          year: trend.year,
          month: trend.month,
          revenue: trend.revenue,
          payments: trend.payments,
        });
      }
    });

    // Sort by year and month
    const monthlyTrends = Array.from(trendsMap.values()).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

    return {
      monthlyTrends,
    };
  }
}
