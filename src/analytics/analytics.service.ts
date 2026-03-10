import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
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

    // Active subscriptions count
    const activeSubscriptionsCount = await this.memberSubscriptionModel
      .countDocuments({ subscriptionStatus: SubscriptionStatus.ACTIVE })
      .exec();

    // Total revenue collected
    const revenueResult = await this.paymentModel.aggregate([
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
        },
      },
    ]);
    const totalRevenue = revenueResult[0]?.totalRevenue || 0;

    // Monthly revenue (current month)
    const monthlyRevenueResult = await this.paymentModel.aggregate([
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
    const monthlyRevenue = monthlyRevenueResult[0]?.monthlyRevenue || 0;

    // Pending amount (all subscriptions)
    const pendingAmountResult = await this.memberSubscriptionModel.aggregate([
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
    const totalPendingAmount = pendingAmountResult[0]?.totalPending || 0;

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

    // Recent payments (last 10)
    const recentPayments = await this.paymentModel
      .find()
      .populate('memberId', 'name email')
      .populate('subscriptionId', 'planId')
      .select('memberId amount paymentMode paymentDate transactionId')
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(10)
      .exec();

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

      recentPayments: recentPayments.map((payment: any) => ({
        memberName: payment.memberId?.name || 'Unknown',
        email: payment.memberId?.email || '',
        amount: payment.amount,
        paymentMode: payment.paymentMode,
        paymentDate: payment.paymentDate,
        transactionId: payment.transactionId,
      })),

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
   * Get revenue analytics
   */
  async getRevenueAnalytics() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // Total revenue all time
    const totalRevenueResult = await this.paymentModel.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
        },
      },
    ]);
    const totalRevenue = totalRevenueResult[0]?.total || 0;

    // Current month revenue
    const currentMonthResult = await this.paymentModel.aggregate([
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
    const currentMonthRevenue = currentMonthResult[0]?.total || 0;
    const currentMonthPayments = currentMonthResult[0]?.count || 0;

    // Last month revenue
    const lastMonthResult = await this.paymentModel.aggregate([
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
    const lastMonthRevenue = lastMonthResult[0]?.total || 0;
    const lastMonthPayments = lastMonthResult[0]?.count || 0;

    // Total pending amount
    const pendingAmountResult = await this.memberSubscriptionModel.aggregate([
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
    const totalPendingAmount = pendingAmountResult[0]?.total || 0;
    const subscriptionsWithPending = pendingAmountResult[0]?.count || 0;

    // Payment mode breakdown
    const paymentModeBreakdown = await this.paymentModel.aggregate([
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
   * Get payment trends (last 6 months)
   */
  async getPaymentTrends() {
    const now = new Date();
    const sixMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 5,
      1,
    );

    const monthlyTrends = await this.paymentModel.aggregate([
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

    return {
      monthlyTrends,
    };
  }
}
