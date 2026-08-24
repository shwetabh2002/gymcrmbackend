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
import { memberDiscountRupeesForAnalytics } from '../common/utils/member-discount.util';
import {
  effectiveMemberStatusAddFieldsStages,
  getCurrentMembership,
  startOfTodayLocal,
} from '../common/utils/member-effective-status.util';
import { EmployeesService } from '../employees/employees.service';
import { MembersService } from '../members/members.service';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(MemberSubscription.name)
    private memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(MemberPayment.name)
    private memberPaymentModel: Model<MemberPaymentDocument>,
    private employeesService: EmployeesService,
    private membersService: MembersService,
  ) {}

  /**
   * Get dashboard overview with key metrics and detailed lists
   * Supports optional date filtering: startDate/endDate, or month/year
   *
   * DISCOUNT-AWARE REVENUE CALCULATION:
   * - Simplified flow: Uses 'received' field from MemberPayment (already post-discount)
   * - Detailed flow: Uses 'amount' field from Payment (should be post-discount when recorded)
   * - All revenue metrics reflect actual collected amounts after discounts
   */
  async getDashboardOverview(
    startDate?: string,
    endDate?: string,
    month?: string,
    year?: string,
  ) {
    const now = new Date();

    // Determine date range based on filters
    let filterStartDate: Date;
    let filterEndDate: Date;

    if (month && year) {
      // Month/Year filter
      const monthNum = parseInt(month, 10) - 1; // JavaScript months are 0-indexed
      const yearNum = parseInt(year, 10);
      filterStartDate = new Date(yearNum, monthNum, 1);
      filterEndDate = new Date(yearNum, monthNum + 1, 0, 23, 59, 59, 999);
    } else if (year && !month) {
      // Year only filter
      const yearNum = parseInt(year, 10);
      filterStartDate = new Date(yearNum, 0, 1);
      filterEndDate = new Date(yearNum, 11, 31, 23, 59, 59, 999);
    } else if (startDate && endDate) {
      // Custom date range
      filterStartDate = new Date(startDate);
      filterEndDate = new Date(endDate);
      filterEndDate.setHours(23, 59, 59, 999);
    } else if (startDate) {
      // Start date only - from start date to now
      filterStartDate = new Date(startDate);
      filterEndDate = now;
    } else {
      // No filter - use current month
      filterStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      filterEndDate = now;
    }

    const startOfMonth = filterStartDate;
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
    );

    // ===== COUNTS =====
    // Total members count
    const totalMembers = await this.userModel
      .countDocuments({ userType: UserType.MEMBER })
      .exec();

    // Active = expiry not passed (effective status), not just stored ACTIVE flag
    const activeUsersAgg = await this.userModel
      .aggregate([
        { $match: { userType: UserType.MEMBER } },
        ...effectiveMemberStatusAddFieldsStages(now),
        { $match: { effectiveMemberStatus: 'ACTIVE' } },
        { $count: 'count' },
      ])
      .exec();
    const activeFromUsers = activeUsersAgg[0]?.count || 0;

    const today = startOfTodayLocal(now);
    const activeFromDetailedFlow = await this.memberSubscriptionModel
      .countDocuments({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        expiryDate: { $gte: today },
      })
      .exec();

    const activeSubscriptionsCount = Math.max(
      activeFromUsers,
      activeFromDetailedFlow,
    );

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

    // Monthly revenue (filtered period) from BOTH flows
    // Detailed flow
    const monthlyRevenueDetailedResult = await this.paymentModel.aggregate([
      {
        $match: {
          paymentDate: { $gte: filterStartDate, $lte: filterEndDate },
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
            paymentDate: { $gte: filterStartDate, $lte: filterEndDate },
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

    // Active members (expiry-based) from users.memberships
    const activeMemberDocs = await this.userModel
      .aggregate([
        { $match: { userType: UserType.MEMBER } },
        ...effectiveMemberStatusAddFieldsStages(now),
        { $match: { effectiveMemberStatus: 'ACTIVE' } },
        { $sort: { createdAt: -1 } },
        { $limit: 10 },
        {
          $project: {
            name: 1,
            email: 1,
            phone: 1,
            memberships: 1,
            membershipAmount: 1,
            memberStatus: 1,
            expiryDate: 1,
          },
        },
      ])
      .exec();

    const activeMembers = activeMemberDocs.map((user: any) => {
      const activeMembership = getCurrentMembership(user);
      return {
        memberName: user.name || 'Unknown',
        email: user.email || '',
        phone: user.phone || '',
        planName:
          activeMembership?.package ||
          `${activeMembership?.months || 0} Month`,
        planPrice: activeMembership?.totalAmount ?? user.membershipAmount ?? 0,
        startDate: activeMembership?.startDate || null,
        expiryDate: activeMembership?.expiryDate || user.expiryDate || null,
        paymentStatus:
          (activeMembership?.pendingAmount ?? 0) > 0 ? 'PARTIAL' : 'PAID',
        pendingAmount: activeMembership?.pendingAmount ?? 0,
      };
    });

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

    // Pending members from users.memberships (simplified flow — real source)
    const pendingMemberDocs = await this.userModel
      .find({
        userType: UserType.MEMBER,
        memberships: { $elemMatch: { pendingAmount: { $gt: 0 } } },
      })
      .select('name email phone memberships membershipAmount')
      .exec();

    const membersWithPendingPayments = pendingMemberDocs
      .map((user: any) => {
        const pendingMemberships = (user.memberships || []).filter(
          (m: any) => (m.pendingAmount || 0) > 0,
        );
        const pendingAmount = pendingMemberships.reduce(
          (sum: number, m: any) => sum + (m.pendingAmount || 0),
          0,
        );
        const activeOrLatest =
          pendingMemberships.find((m: any) => m.status === 'ACTIVE') ||
          pendingMemberships[0];
        return {
          memberName: user.name || 'Unknown',
          email: user.email || '',
          phone: user.phone || '',
          planName:
            activeOrLatest?.package ||
            `${activeOrLatest?.months || 0} Month`,
          planPrice:
            activeOrLatest?.totalAmount ?? user.membershipAmount ?? 0,
          totalPaid: activeOrLatest?.amountPaid ?? 0,
          pendingAmount,
          paymentStatus: 'PARTIAL',
        };
      })
      .sort((a, b) => b.pendingAmount - a.pendingAmount);

    const membersWithPendingPaymentsCount = membersWithPendingPayments.length;

    // Distinct members with pending balance in MemberPayment collection
    const pendingFromPaymentsAgg = await this.memberPaymentModel.aggregate([
      { $match: { pending: { $gt: 0 } } },
      { $group: { _id: '$memberId' } },
      { $count: 'count' },
    ]);
    const pendingFromPaymentsCount = pendingFromPaymentsAgg[0]?.count || 0;

    // Also include detailed-flow pending if any remain (legacy)
    const pendingDetailedCount = await this.memberSubscriptionModel
      .countDocuments({
        subscriptionStatus: { $ne: SubscriptionStatus.CANCELLED },
        pendingAmount: { $gt: 0 },
      })
      .exec();

    const membersWithPendingPaymentsTotal = Math.max(
      membersWithPendingPaymentsCount,
      pendingFromPaymentsCount,
      pendingDetailedCount,
    );

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

    // ===== DISCOUNT ANALYTICS =====
    // Calculate total discount given across all members
    const membersWithDiscount = await this.userModel
      .find({
        userType: UserType.MEMBER,
        $or: [
          { discount: { $gt: 0 } },
          { discountAmount: { $gt: 0 } },
        ],
      })
      .select('amount discount discountAmount discountApprovedBy')
      .exec();

    let totalDiscountGiven = 0;
    let discountedMembersCount = 0;
    const discountByApprover: Record<string, number> = {};

    for (const member of membersWithDiscount) {
      const rupees = memberDiscountRupeesForAnalytics(member);

      totalDiscountGiven += rupees;
      discountedMembersCount++;

      // Track discount by approver
      const approver = member.discountApprovedBy || 'Unknown';
      discountByApprover[approver] = (discountByApprover[approver] || 0) + rupees;
    }

    return {
      // Counts
      counts: {
        totalMembers,
        activeSubscriptions: activeSubscriptionsCount,
        totalRevenue,
        monthlyRevenue,
        totalPendingAmount,
        membersNearExpiry: membersNearExpiry.length,
        membersWithPendingPayments: membersWithPendingPaymentsTotal,
        newMembersThisMonth: newMembers.length,
        totalDiscountGiven,
        discountedMembersCount,
      },

      // Discount analytics
      discountAnalytics: {
        totalDiscountGiven,
        discountedMembersCount,
        discountByApprover,
        averageDiscountPerMember: discountedMembersCount > 0 ? totalDiscountGiven / discountedMembersCount : 0,
      },

      // Detailed Lists
      activeMembers,

      membersNearExpiry: membersNearExpiryWithDays,

      membersWithPendingPayments: membersWithPendingPayments.slice(0, 10),

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
   *
   * DISCOUNT-AWARE REVENUE:
   * - All revenue calculations use actual received/paid amounts (post-discount)
   * - Simplified flow: $sum on 'received' field
   * - Detailed flow: $sum on 'amount' field (should already be discounted when payment is recorded)
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
   *
   * DISCOUNT-AWARE REVENUE TRENDS:
   * - Revenue trends show actual collected amounts (post-discount)
   * - Simplified flow: Aggregates 'received' field
   * - Detailed flow: Aggregates 'amount' field
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

  /**
   * Get members expiring in next 7 days from BOTH flows (detailed + simplified memberships array)
   */
  async getMembersExpiringIn7Days() {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Detailed flow: from MemberSubscription model
    const expiringDetailedFlow = await this.memberSubscriptionModel
      .find({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        expiryDate: { $gte: now, $lte: sevenDaysFromNow },
      })
      .populate('memberId', 'name email phone')
      .populate('planId', 'name price')
      .select('memberId planId expiryDate pendingAmount paymentStatus')
      .sort({ expiryDate: 1 })
      .exec();

    // Simplified flow: from User.memberships array
    const usersWithExpiringMemberships = await this.userModel
      .find({
        userType: UserType.MEMBER,
        'memberships.status': 'ACTIVE',
        'memberships.expiryDate': { $gte: now, $lte: sevenDaysFromNow },
      })
      .select('name email phone memberships')
      .exec();

    // Combine results
    const expiringList: any[] = [];

    // Add detailed flow results
    expiringDetailedFlow.forEach((sub: any) => {
      const daysRemaining = Math.ceil(
        (new Date(sub.expiryDate).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      expiringList.push({
        memberName: sub.memberId?.name || 'Unknown',
        email: sub.memberId?.email || '',
        phone: sub.memberId?.phone || '',
        planName: sub.planId?.name || 'Unknown Plan',
        expiryDate: sub.expiryDate,
        daysRemaining,
        pendingAmount: sub.pendingAmount || 0,
        paymentStatus: sub.paymentStatus,
        flow: 'detailed',
      });
    });

    // Add simplified flow results (from memberships array)
    usersWithExpiringMemberships.forEach((user: any) => {
      const activeMemberships = user.memberships.filter(
        (m: any) =>
          m.status === 'ACTIVE' &&
          new Date(m.expiryDate) >= now &&
          new Date(m.expiryDate) <= sevenDaysFromNow,
      );

      activeMemberships.forEach((membership: any) => {
        const daysRemaining = Math.ceil(
          (new Date(membership.expiryDate).getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        expiringList.push({
          memberName: user.name || 'Unknown',
          email: user.email || '',
          phone: user.phone || '',
          planName: membership.package || 'Standard',
          expiryDate: membership.expiryDate,
          daysRemaining,
          pendingAmount: membership.pendingAmount || 0,
          paymentStatus:
            membership.pendingAmount > 0 ? 'PENDING' : 'COMPLETED',
          flow: 'simplified',
        });
      });
    });

    // Sort by expiry date (earliest first)
    expiringList.sort(
      (a, b) =>
        new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime(),
    );

    return {
      count: expiringList.length,
      members: expiringList,
    };
  }

  /**
   * Expired = member's latest subscription end date has already passed
   * (and they have not renewed — no later/valid membership after that).
   */
  async getExpiredMembers() {
    const now = new Date();
    const LIST_LIMIT = 100;

    // Simplified flow (main CRM path): pick latest membership per user
    const simplifiedAgg = await this.userModel
      .aggregate([
        { $match: { userType: UserType.MEMBER } },
        {
          $addFields: {
            latestMembership: {
              $first: {
                $sortArray: {
                  input: { $ifNull: ['$memberships', []] },
                  sortBy: { expiryDate: -1, startDate: -1 },
                },
              },
            },
          },
        },
        {
          $match: {
            'latestMembership.expiryDate': { $exists: true, $ne: null, $lt: now },
          },
        },
        { $sort: { 'latestMembership.expiryDate': -1 } },
        {
          $project: {
            name: 1,
            email: 1,
            phone: 1,
            latestMembership: 1,
          },
        },
      ])
      .exec();

    // Detailed flow subscriptions
    const detailedAgg = await this.memberSubscriptionModel
      .aggregate([
        {
          $sort: { expiryDate: -1 },
        },
        {
          $group: {
            _id: '$memberId',
            latest: { $first: '$$ROOT' },
          },
        },
        {
          $match: {
            'latest.expiryDate': { $lt: now },
          },
        },
        { $sort: { 'latest.expiryDate': -1 } },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'member',
          },
        },
        { $unwind: { path: '$member', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'subscriptionplans',
            localField: 'latest.planId',
            foreignField: '_id',
            as: 'plan',
          },
        },
        { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
      ])
      .exec();

    const expiredList: any[] = [];
    const seen = new Set<string>();

    for (const row of simplifiedAgg) {
      const key = String(row._id);
      if (seen.has(key)) continue;
      seen.add(key);
      const m = row.latestMembership;
      const daysOverdue = Math.max(
        1,
        Math.ceil(
          (now.getTime() - new Date(m.expiryDate).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      expiredList.push({
        memberName: row.name || 'Unknown',
        email: row.email || '',
        phone: row.phone || '',
        planName: m.package || 'Standard',
        expiryDate: m.expiryDate,
        daysOverdue,
        pendingAmount: m.pendingAmount || 0,
        paymentStatus: (m.pendingAmount || 0) > 0 ? 'PENDING' : 'COMPLETED',
        flow: 'simplified',
      });
    }

    for (const row of detailedAgg) {
      const key = String(row._id);
      if (seen.has(key)) continue;
      // Skip if this member already has a simplified memberships array entry handled above
      // (seen already covers). Also skip if they somehow have valid simplified membership —
      // already excluded by simplified query.
      seen.add(key);
      const sub = row.latest;
      const daysOverdue = Math.max(
        1,
        Math.ceil(
          (now.getTime() - new Date(sub.expiryDate).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      expiredList.push({
        memberName: row.member?.name || 'Unknown',
        email: row.member?.email || '',
        phone: row.member?.phone || '',
        planName: row.plan?.name || 'Unknown Plan',
        expiryDate: sub.expiryDate,
        daysOverdue,
        pendingAmount: sub.pendingAmount || 0,
        paymentStatus: sub.paymentStatus,
        flow: 'detailed',
      });
    }

    expiredList.sort(
      (a, b) =>
        new Date(b.expiryDate).getTime() - new Date(a.expiryDate).getTime(),
    );

    return {
      count: expiredList.length,
      members: expiredList.slice(0, LIST_LIMIT),
      showing: Math.min(LIST_LIMIT, expiredList.length),
    };
  }

  /**
   * Get recent payment updates/activity from BOTH flows with more details
   */
  async getPaymentUpdates(limit: number = 20) {
    // Detailed flow payments
    const recentPaymentsDetailed = await this.paymentModel
      .find()
      .populate('memberId', 'name email phone')
      .populate('subscriptionId', 'planId')
      .select('memberId amount paymentMode paymentDate transactionId createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    // Simplified flow payments
    const recentPaymentsSimplified = await this.memberPaymentModel
      .find()
      .populate('memberId', 'name email phone')
      .select(
        'memberId amount received pending mop paymentDate transactionId notes createdAt',
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    // Combine and sort both payment types
    const allPaymentUpdates = [
      ...recentPaymentsDetailed.map((p: any) => ({
        memberName: p.memberId?.name || 'Unknown',
        email: p.memberId?.email || '',
        phone: p.memberId?.phone || '',
        amount: p.amount,
        paymentMode: p.paymentMode,
        paymentDate: p.paymentDate,
        transactionId: p.transactionId,
        createdAt: p.createdAt,
        flow: 'detailed',
      })),
      ...recentPaymentsSimplified.map((p: any) => ({
        memberName: p.memberId?.name || 'Unknown',
        email: p.memberId?.email || '',
        phone: p.memberId?.phone || '',
        amount: p.amount,
        received: p.received,
        pending: p.pending,
        paymentMode: p.mop,
        paymentDate: p.paymentDate,
        transactionId: p.transactionId,
        notes: p.notes,
        createdAt: p.createdAt,
        flow: 'simplified',
      })),
    ]
      .sort((a, b) => {
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      })
      .slice(0, limit);

    return {
      count: allPaymentUpdates.length,
      payments: allPaymentUpdates,
    };
  }

  /** Dashboard: staff + members with birthday today or tomorrow (single API for CRM). */
  async getUpcomingBirthdays() {
    const [employees, members] = await Promise.all([
      this.employeesService.getUpcomingBirthdays(),
      this.membersService.getUpcomingBirthdays(),
    ]);
    return [...employees, ...members];
  }

  /** Dashboard: staff + members with anniversary today or tomorrow. */
  async getUpcomingAnniversaries() {
    const [employees, members] = await Promise.all([
      this.employeesService.getUpcomingAnniversaries(),
      this.membersService.getUpcomingAnniversaries(),
    ]);
    return [...employees, ...members];
  }
}
