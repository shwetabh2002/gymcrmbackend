import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from './schemas/member-subscription.schema';
import { CreateMemberSubscriptionDto } from './dto/create-member-subscription.dto';
import { UpdateMemberSubscriptionDto } from './dto/update-member-subscription.dto';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  SubscriptionPlan,
  SubscriptionPlanDocument,
} from '../subscription-plans/schemas/subscription-plan.schema';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { PaymentStatus } from '../common/enums/payment-status.enum';
import { UserType } from '../common/enums/user-type.enum';

@Injectable()
export class MemberSubscriptionsService {
  constructor(
    @InjectModel(MemberSubscription.name)
    private memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(SubscriptionPlan.name)
    private subscriptionPlanModel: Model<SubscriptionPlanDocument>,
  ) {}

  async create(
    createDto: CreateMemberSubscriptionDto,
  ): Promise<MemberSubscriptionDocument> {
    // Verify member exists and is a member type
    const member = await this.userModel
      .findOne({ _id: createDto.memberId, userType: UserType.MEMBER })
      .exec();
    if (!member) {
      throw new NotFoundException(
        `Member with ID ${createDto.memberId} not found`,
      );
    }

    // Verify subscription plan exists
    const plan = await this.subscriptionPlanModel
      .findById(createDto.planId)
      .exec();
    if (!plan) {
      throw new NotFoundException(
        `Subscription plan with ID ${createDto.planId} not found`,
      );
    }

    // Check if member has an active subscription
    const activeSubscription = await this.memberSubscriptionModel
      .findOne({
        memberId: createDto.memberId as any,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      })
      .exec();

    if (activeSubscription) {
      throw new ConflictException(
        `Member already has an active subscription. Please expire or cancel the existing subscription first.`,
      );
    }

    // Calculate expiry date based on plan duration
    const startDate = new Date(createDto.startDate);
    const expiryDate = new Date(startDate);

    switch (plan.durationType) {
      case 'DAYS':
        expiryDate.setDate(expiryDate.getDate() + plan.duration);
        break;
      case 'MONTHS':
        expiryDate.setMonth(expiryDate.getMonth() + plan.duration);
        break;
      case 'YEARS':
        expiryDate.setFullYear(expiryDate.getFullYear() + plan.duration);
        break;
    }

    // Calculate initial payment status
    const initialPayment = createDto.initialPayment || 0;
    const pendingAmount = plan.price - initialPayment;
    let paymentStatus = PaymentStatus.UNPAID;

    if (initialPayment >= plan.price) {
      paymentStatus = PaymentStatus.FULLY_PAID;
    } else if (initialPayment > 0) {
      paymentStatus = PaymentStatus.PARTIALLY_PAID;
    }

    // Create subscription
    const subscription = new this.memberSubscriptionModel({
      memberId: createDto.memberId,
      planId: createDto.planId,
      startDate: startDate,
      expiryDate: expiryDate,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      planPrice: plan.price,
      totalPaid: initialPayment,
      pendingAmount: pendingAmount,
      paymentStatus: paymentStatus,
    });

    const savedSubscription = await subscription.save();

    // Update member's currentSubscriptionId
    await this.userModel
      .findByIdAndUpdate(createDto.memberId, {
        currentSubscriptionId: savedSubscription._id,
      })
      .exec();

    return savedSubscription;
  }

  async findAll(): Promise<MemberSubscriptionDocument[]> {
    return this.memberSubscriptionModel
      .find()
      .populate('memberId', '-password -refreshToken')
      .populate('planId')
      .exec();
  }

  async findById(id: string): Promise<MemberSubscriptionDocument> {
    const subscription = await this.memberSubscriptionModel
      .findById(id)
      .populate('memberId', '-password -refreshToken')
      .populate('planId')
      .exec();

    if (!subscription) {
      throw new NotFoundException(
        `Member subscription with ID ${id} not found`,
      );
    }

    return subscription;
  }

  async findByMemberId(memberId: string): Promise<MemberSubscriptionDocument[]> {
    // Verify member exists
    const member = await this.userModel
      .findOne({ _id: memberId, userType: UserType.MEMBER })
      .exec();
    if (!member) {
      throw new NotFoundException(`Member with ID ${memberId} not found`);
    }

    return this.memberSubscriptionModel
      .find({ memberId: memberId as any })
      .populate('planId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    id: string,
    updateDto: UpdateMemberSubscriptionDto,
  ): Promise<MemberSubscriptionDocument> {
    const subscription = await this.memberSubscriptionModel.findById(id).exec();

    if (!subscription) {
      throw new NotFoundException(
        `Member subscription with ID ${id} not found`,
      );
    }

    // If subscription status is being updated, validate the change
    if (updateDto.subscriptionStatus) {
      // If changing to EXPIRED or CANCELLED, remove from member's current subscription
      if (
        updateDto.subscriptionStatus === SubscriptionStatus.EXPIRED ||
        updateDto.subscriptionStatus === SubscriptionStatus.CANCELLED
      ) {
        await this.userModel
          .findByIdAndUpdate(subscription.memberId, {
            currentSubscriptionId: null,
          })
          .exec();
      }
    }

    const updatedSubscription = await this.memberSubscriptionModel
      .findByIdAndUpdate(id, updateDto, { new: true })
      .populate('memberId', '-password -refreshToken')
      .populate('planId')
      .exec();

    if (!updatedSubscription) {
      throw new NotFoundException(
        `Member subscription with ID ${id} not found`,
      );
    }

    return updatedSubscription as MemberSubscriptionDocument;
  }

  async delete(id: string): Promise<void> {
    const subscription = await this.memberSubscriptionModel.findById(id).exec();

    if (!subscription) {
      throw new NotFoundException(
        `Member subscription with ID ${id} not found`,
      );
    }

    // Remove from member's current subscription if it's the active one
    const member = await this.userModel.findById(subscription.memberId).exec();
    if (
      member &&
      member.currentSubscriptionId?.toString() === id.toString()
    ) {
      await this.userModel
        .findByIdAndUpdate(subscription.memberId, {
          currentSubscriptionId: null,
        })
        .exec();
    }

    await this.memberSubscriptionModel.findByIdAndDelete(id).exec();
  }

  async addPayment(
    subscriptionId: string,
    paymentAmount: number,
  ): Promise<MemberSubscriptionDocument> {
    if (paymentAmount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    const subscription =
      await this.memberSubscriptionModel.findById(subscriptionId).exec();

    if (!subscription) {
      throw new NotFoundException(
        `Member subscription with ID ${subscriptionId} not found`,
      );
    }

    await this.applyPaymentDelta(subscriptionId, paymentAmount);

    // Re-read with populated relations for the response.
    return this.findById(subscriptionId);
  }

  /**
   * Atomically adjust a subscription's paid/pending totals by `delta`
   * (positive for a payment, negative to reverse a voided one) and recompute
   * the derived pendingAmount and paymentStatus — all in a single
   * aggregation-pipeline update so concurrent payments can't lose writes (P0-9).
   */
  async applyPaymentDelta(
    subscriptionId: string,
    delta: number,
  ): Promise<MemberSubscriptionDocument | null> {
    return this.memberSubscriptionModel
      .findByIdAndUpdate(
        subscriptionId,
        [
          {
            $set: {
              totalPaid: { $max: [0, { $add: ['$totalPaid', delta] }] },
            },
          },
          {
            $set: {
              pendingAmount: {
                $max: [0, { $subtract: ['$planPrice', '$totalPaid'] }],
              },
              paymentStatus: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $lte: [{ $subtract: ['$planPrice', '$totalPaid'] }, 0],
                      },
                      then: PaymentStatus.FULLY_PAID,
                    },
                    {
                      case: { $gt: ['$totalPaid', 0] },
                      then: PaymentStatus.PARTIALLY_PAID,
                    },
                  ],
                  default: PaymentStatus.UNPAID,
                },
              },
            },
          },
        ],
        { new: true },
      )
      .exec();
  }
}
