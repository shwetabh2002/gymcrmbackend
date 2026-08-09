import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
import { PaymentMode } from '../common/enums/payment-mode.enum';
import { UserType } from '../common/enums/user-type.enum';
import {
  ActivityLogsService,
  ActivityActor,
} from '../activity-logs/activity-logs.service';
import { PaymentsService } from '../payments/payments.service';
import { CompanyContextService } from '../common/company-context/company-context.service';

type LocScope = { locationId?: string };

@Injectable()
export class MemberSubscriptionsService {
  constructor(
    @InjectModel(MemberSubscription.name)
    private memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(SubscriptionPlan.name)
    private subscriptionPlanModel: Model<SubscriptionPlanDocument>,
    private activityLogsService: ActivityLogsService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
    private companyContext: CompanyContextService,
  ) {}

  async create(
    companyId: string,
    createDto: CreateMemberSubscriptionDto,
    actor?: ActivityActor,
    writeLocationId?: string,
  ) {
    const member = await this.userModel
      .findOne({
        _id: createDto.memberId,
        companyId,
        userType: UserType.MEMBER,
      })
      .exec();
    if (!member) {
      throw new NotFoundException(
        `Member with ID ${createDto.memberId} not found`,
      );
    }

    const locationId =
      (member.locationId ? String(member.locationId) : null) || writeLocationId;
    if (!locationId) {
      throw new BadRequestException(
        'locationId required — member has no location and none was provided',
      );
    }

    const plan = await this.subscriptionPlanModel
      .findOne({ _id: createDto.planId, companyId })
      .exec();
    if (!plan) {
      throw new NotFoundException(
        `Subscription plan with ID ${createDto.planId} not found`,
      );
    }

    const activeSubscription = await this.memberSubscriptionModel
      .findOne({
        companyId,
        memberId: createDto.memberId as any,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      })
      .exec();

    if (activeSubscription) {
      if (createDto.replaceActive) {
        activeSubscription.subscriptionStatus = SubscriptionStatus.CANCELLED;
        await activeSubscription.save();
      } else {
        throw new ConflictException(
          `Member already has an active subscription. Enable replaceActive to cancel it and assign a new plan.`,
        );
      }
    }

    const startDate = new Date(createDto.startDate);
    const expiryDate = createDto.expiryDate
      ? new Date(createDto.expiryDate)
      : MemberSubscriptionsService.addPlanDuration(
          startDate,
          plan.duration,
          plan.durationType,
        );

    const initialPayment = createDto.initialPayment || 0;
    if (initialPayment > plan.price) {
      throw new BadRequestException(
        `Initial payment cannot exceed plan price ${await this.companyContext.formatMoney(
          companyId,
          plan.price,
        )}`,
      );
    }

    // Start unpaid; PaymentsService.applyPaymentDelta + invoice if money collected
    const subscription = new this.memberSubscriptionModel({
      companyId,
      locationId,
      memberId: createDto.memberId,
      planId: createDto.planId,
      startDate: startDate,
      expiryDate: expiryDate,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      planPrice: plan.price,
      totalPaid: 0,
      pendingAmount: plan.price,
      paymentStatus: PaymentStatus.UNPAID,
    });

    const savedSubscription = await subscription.save();

    try {
      await this.userModel
        .findOneAndUpdate(
          { _id: createDto.memberId, companyId, userType: UserType.MEMBER },
          { currentSubscriptionId: savedSubscription._id },
        )
        .exec();

      let initialPaymentId: string | null = null;
      if (initialPayment > 0) {
        if (!actor?.userId) {
          throw new BadRequestException(
            'Cannot record initial payment without a staff user',
          );
        }
        const payment = await this.paymentsService.create(
          companyId,
          {
            memberId: createDto.memberId,
            subscriptionId: String(savedSubscription._id),
            amount: initialPayment,
            paymentMode: createDto.paymentMode || PaymentMode.CASH,
            paymentDate: createDto.startDate,
            notes: 'Initial payment on subscription assign',
          },
          actor.userId,
          actor,
          locationId,
        );
        initialPaymentId = String(payment._id);
      }

      if (actor) {
        try {
          await this.activityLogsService.log({
            companyId,
            locationId,
            actor,
            action: 'SUBSCRIPTION_CREATE',
            entityType: 'subscription',
            entityId: String(savedSubscription._id),
            summary: `${actor.name} assigned ${plan.name} to ${member.name}`,
            metadata: {
              planId: createDto.planId,
              memberId: createDto.memberId,
              planPrice: plan.price,
              initialPayment,
              initialPaymentId,
            },
          });
        } catch {
          // non-fatal
        }
      }

      const populated = await this.findById(
        companyId,
        String(savedSubscription._id),
      );
      return Object.assign(
        populated.toObject ? populated.toObject() : populated,
        {
          initialPaymentId,
        },
      );
    } catch (err) {
      // Roll back subscription if payment/follow-up fails after save
      await this.memberSubscriptionModel
        .deleteOne({ _id: savedSubscription._id, companyId })
        .exec();
      if (activeSubscription && createDto.replaceActive) {
        await this.memberSubscriptionModel
          .updateOne(
            { _id: activeSubscription._id, companyId },
            { subscriptionStatus: SubscriptionStatus.ACTIVE },
          )
          .exec();
        await this.userModel
          .findOneAndUpdate(
            { _id: createDto.memberId, companyId, userType: UserType.MEMBER },
            { currentSubscriptionId: activeSubscription._id },
          )
          .exec();
      } else {
        await this.userModel
          .findOneAndUpdate(
            {
              _id: createDto.memberId,
              companyId,
              userType: UserType.MEMBER,
              currentSubscriptionId: savedSubscription._id,
            } as any,
            { currentSubscriptionId: null },
          )
          .exec();
      }
      throw err;
    }
  }

  async findAll(
    companyId: string,
    locScope: LocScope = {},
  ): Promise<MemberSubscriptionDocument[]> {
    return this.memberSubscriptionModel
      .find({ companyId, ...locScope })
      .populate('memberId', '-password -refreshToken')
      .populate('planId')
      .exec();
  }

  async findById(
    companyId: string,
    id: string,
    locScope: LocScope = {},
  ): Promise<MemberSubscriptionDocument> {
    const subscription = await this.memberSubscriptionModel
      .findOne({ _id: id, companyId, ...locScope })
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

  async findByMemberId(
    companyId: string,
    memberId: string,
    locScope: LocScope = {},
  ): Promise<MemberSubscriptionDocument[]> {
    const member = await this.userModel
      .findOne({
        _id: memberId,
        companyId,
        userType: UserType.MEMBER,
        ...locScope,
      })
      .exec();
    if (!member) {
      throw new NotFoundException(`Member with ID ${memberId} not found`);
    }

    return this.memberSubscriptionModel
      .find({ companyId, memberId: memberId as any, ...locScope })
      .populate('planId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    companyId: string,
    id: string,
    updateDto: UpdateMemberSubscriptionDto,
    actor?: ActivityActor,
    locScope: LocScope = {},
  ): Promise<MemberSubscriptionDocument> {
    const subscription = await this.memberSubscriptionModel
      .findOne({ _id: id, companyId, ...locScope })
      .exec();

    if (!subscription) {
      throw new NotFoundException(
        `Member subscription with ID ${id} not found`,
      );
    }

    if (updateDto.subscriptionStatus) {
      if (
        updateDto.subscriptionStatus === SubscriptionStatus.EXPIRED ||
        updateDto.subscriptionStatus === SubscriptionStatus.CANCELLED
      ) {
        await this.userModel
          .findOneAndUpdate(
            {
              _id: subscription.memberId,
              companyId,
              userType: UserType.MEMBER,
            },
            { currentSubscriptionId: null },
          )
          .exec();
      }
    }

    const {
      companyId: _ignore,
      locationId: _loc,
      ...safeUpdate
    } = updateDto as any;

    const updatedSubscription = await this.memberSubscriptionModel
      .findOneAndUpdate({ _id: id, companyId }, safeUpdate, {
        returnDocument: 'after',
      })
      .populate('memberId', '-password -refreshToken')
      .populate('planId')
      .exec();

    if (!updatedSubscription) {
      throw new NotFoundException(
        `Member subscription with ID ${id} not found`,
      );
    }

    if (actor) {
      const memberName =
        (updatedSubscription as any).memberId?.name || 'member';
      await this.activityLogsService.log({
        companyId,
        locationId: updatedSubscription.locationId
          ? String(updatedSubscription.locationId)
          : null,
        actor,
        action: 'SUBSCRIPTION_UPDATE',
        entityType: 'subscription',
        entityId: id,
        summary: `${actor.name} updated subscription for ${memberName}`,
        metadata: updateDto as any,
      });
    }

    return updatedSubscription as MemberSubscriptionDocument;
  }

  async delete(
    companyId: string,
    id: string,
    actor?: ActivityActor,
    locScope: LocScope = {},
  ): Promise<void> {
    const subscription = await this.memberSubscriptionModel
      .findOne({ _id: id, companyId, ...locScope })
      .exec();

    if (!subscription) {
      throw new NotFoundException(
        `Member subscription with ID ${id} not found`,
      );
    }

    const member = await this.userModel
      .findOne({
        _id: subscription.memberId,
        companyId,
        userType: UserType.MEMBER,
      })
      .exec();
    if (member && member.currentSubscriptionId?.toString() === id.toString()) {
      await this.userModel
        .findOneAndUpdate(
          { _id: subscription.memberId, companyId },
          { currentSubscriptionId: null },
        )
        .exec();
    }

    await this.memberSubscriptionModel
      .findOneAndDelete({ _id: id, companyId })
      .exec();

    if (actor) {
      await this.activityLogsService.log({
        companyId,
        locationId: subscription.locationId
          ? String(subscription.locationId)
          : null,
        actor,
        action: 'SUBSCRIPTION_DELETE',
        entityType: 'subscription',
        entityId: id,
        summary: `${actor.name} deleted subscription for ${member?.name || 'member'}`,
      });
    }
  }

  async addPayment(
    companyId: string,
    subscriptionId: string,
    paymentAmount: number,
  ): Promise<MemberSubscriptionDocument> {
    if (paymentAmount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    const subscription = await this.memberSubscriptionModel
      .findOne({ _id: subscriptionId, companyId })
      .exec();

    if (!subscription) {
      throw new NotFoundException(
        `Member subscription with ID ${subscriptionId} not found`,
      );
    }

    await this.applyPaymentDelta(companyId, subscriptionId, paymentAmount);

    return this.findById(companyId, subscriptionId);
  }

  /**
   * Advance `from` by a plan's own duration. Used by renewals so a quarterly or
   * yearly plan is not silently treated as monthly.
   */
  static addPlanDuration(
    from: Date,
    duration: number,
    durationType: string,
  ): Date {
    const next = new Date(from);
    const units = Number(duration) > 0 ? Number(duration) : 1;
    switch (durationType) {
      case 'DAYS':
        next.setDate(next.getDate() + units);
        break;
      case 'YEARS':
        next.setFullYear(next.getFullYear() + units);
        break;
      case 'MONTHS':
      default:
        next.setMonth(next.getMonth() + units);
        break;
    }
    return next;
  }

  /**
   * Roll a subscription into its next billing cycle: fresh price snapshot,
   * cycle totals zeroed, expiry extended by the plan's real duration.
   * The caller records the renewal payment afterwards via applyPaymentDelta.
   */
  async startNewCycle(
    companyId: string,
    subscriptionId: string,
  ): Promise<MemberSubscriptionDocument> {
    const sub = await this.memberSubscriptionModel
      .findOne({ _id: subscriptionId, companyId })
      .exec();
    if (!sub) {
      throw new NotFoundException(
        `Member subscription with ID ${subscriptionId} not found`,
      );
    }

    const plan = await this.subscriptionPlanModel
      .findOne({ _id: sub.planId, companyId })
      .exec();

    const cycleStart = new Date(Math.max(sub.expiryDate.getTime(), Date.now()));
    const nextExpiry = plan
      ? MemberSubscriptionsService.addPlanDuration(
          cycleStart,
          plan.duration,
          plan.durationType,
        )
      : MemberSubscriptionsService.addPlanDuration(cycleStart, 1, 'MONTHS');

    // Re-snapshot the price so a plan price change applies from this cycle on.
    const cyclePrice = plan ? plan.price : sub.planPrice;

    sub.planPrice = cyclePrice;
    sub.totalPaid = 0;
    sub.pendingAmount = cyclePrice;
    sub.paymentStatus = PaymentStatus.UNPAID;
    sub.cycleStartDate = cycleStart;
    sub.expiryDate = nextExpiry;
    sub.subscriptionStatus = SubscriptionStatus.ACTIVE;
    sub.renewalCount = (sub.renewalCount || 0) + 1;
    sub.lastRenewedAt = new Date();
    await sub.save();

    return sub;
  }

  /**
   * Atomically adjust paid/pending totals by `delta`.
   * Uses the MongoDB driver pipeline update (not mongoose Model.findOneAndUpdate),
   * which avoids mongoose 9's updatePipeline gate while staying race-safe.
   */
  async applyPaymentDelta(
    companyId: string,
    subscriptionId: string,
    delta: number,
  ): Promise<MemberSubscriptionDocument | null> {
    const _id = new Types.ObjectId(subscriptionId);
    const companyOid = new Types.ObjectId(companyId);

    const result =
      await this.memberSubscriptionModel.collection.findOneAndUpdate(
        { _id, companyId: companyOid },
        [
          {
            $set: {
              totalPaid: {
                $max: [0, { $add: [{ $ifNull: ['$totalPaid', 0] }, delta] }],
              },
              // Cycle-independent running total — never reset by a renewal.
              lifetimePaid: {
                $max: [
                  0,
                  {
                    $add: [
                      {
                        $ifNull: [
                          '$lifetimePaid',
                          { $ifNull: ['$totalPaid', 0] },
                        ],
                      },
                      delta,
                    ],
                  },
                ],
              },
            },
          },
          {
            $set: {
              pendingAmount: {
                $max: [
                  0,
                  {
                    $subtract: [{ $ifNull: ['$planPrice', 0] }, '$totalPaid'],
                  },
                ],
              },
              paymentStatus: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $lte: [
                          {
                            $subtract: [
                              { $ifNull: ['$planPrice', 0] },
                              '$totalPaid',
                            ],
                          },
                          0,
                        ],
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
              updatedAt: new Date(),
            },
          },
        ],
        { returnDocument: 'after' },
      );

    // Driver return shape varies by version: document | { value: document }
    const doc = (result as any)?.value ?? result;
    if (!doc) return null;
    return this.memberSubscriptionModel.hydrate(
      doc,
    ) as MemberSubscriptionDocument;
  }
}
