import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  CheckoutSession,
  CheckoutSessionDocument,
} from './schemas/checkout-session.schema';
import {
  PaymentMandate,
  PaymentMandateDocument,
} from './schemas/payment-mandate.schema';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CheckoutSessionStatus } from '../common/enums/checkout-session-status.enum';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  SubscriptionPlan,
  SubscriptionPlanDocument,
} from '../subscription-plans/schemas/subscription-plan.schema';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { UserType } from '../common/enums/user-type.enum';
import { Role } from '../common/enums/role.enum';
import { MemberStatus } from '../common/enums/member-status.enum';
import { MemberOnboardingStatus, BillingMode, MandateStatus, PaymentSource } from '../common/enums/billing.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { PaymentStatus } from '../common/enums/payment-status.enum';
import { PaymentMode } from '../common/enums/payment-mode.enum';
import { CountersService } from '../counters/counters.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { LocationsService } from '../locations/locations.service';
import { PaymentProviderService } from '../payment-provider/payment-provider.service';
import { RazorpayApiService } from '../payment-provider/razorpay-api.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { PaymentsService } from '../payments/payments.service';
import { RenewalFollowUpStatus } from '../common/enums/renewal-follow-up-status.enum';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @InjectModel(CheckoutSession.name)
    private sessionModel: Model<CheckoutSessionDocument>,
    @InjectModel(PaymentMandate.name)
    private mandateModel: Model<PaymentMandateDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(SubscriptionPlan.name)
    private planModel: Model<SubscriptionPlanDocument>,
    @InjectModel(MemberSubscription.name)
    private subModel: Model<MemberSubscriptionDocument>,
    private counters: CountersService,
    private gymSettings: GymSettingsService,
    private locations: LocationsService,
    private paymentProvider: PaymentProviderService,
    private razorpay: RazorpayApiService,
    private whatsapp: WhatsAppService,
    private paymentsService: PaymentsService,
  ) {}

  async createCheckout(
    companyId: string,
    dto: CreateCheckoutDto,
    staffUserId: string,
  ) {
    await this.locations.assertBelongsToCompany(companyId, dto.locationId);
    await this.paymentProvider.requireConnected(companyId);

    if (dto.idempotencyKey) {
      const existing = await this.sessionModel
        .findOne({ companyId, idempotencyKey: dto.idempotencyKey })
        .exec();
      if (existing) return this.toClient(existing);
    }

    const phone = dto.phone.trim();
    const phoneClash = await this.userModel
      .findOne({ companyId, userType: UserType.MEMBER, phone })
      .exec();
    if (phoneClash && phoneClash.onboardingStatus === MemberOnboardingStatus.ACTIVE) {
      throw new BadRequestException(
        `Phone ${phone} is already registered for a member`,
      );
    }

    const plan = await this.planModel
      .findOne({ _id: dto.planId, companyId })
      .exec();
    if (!plan) throw new NotFoundException('Plan not found');

    const amount = dto.amount ?? plan.price;
    const received = dto.received;
    if (received <= 0 || received > amount) {
      throw new BadRequestException(
        'received must be > 0 and ≤ plan amount for online checkout',
      );
    }

    const startDate = new Date(dto.startingDate);
    let expiryDate: Date;
    if (dto.expiryDate) {
      expiryDate = new Date(dto.expiryDate);
    } else {
      expiryDate = new Date(startDate);
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
    }

    const settings = await this.gymSettings.get(companyId);
    const companyAutopayOn = settings.autopayEnabled === true;
    const enableAutopay = companyAutopayOn && dto.enableAutopay !== false;

    const idNo = await this.counters.nextMemberId(
      settings.memberIdPrefix || 'GYM',
      companyId,
    );

    let draft: UserDocument;
    if (
      phoneClash &&
      phoneClash.onboardingStatus === MemberOnboardingStatus.AWAITING_MANDATE
    ) {
      draft = phoneClash;
      draft.name = dto.name.trim();
      draft.locationId = new Types.ObjectId(dto.locationId) as any;
      await draft.save();
    } else {
      draft = await this.userModel.create({
        name: dto.name.trim(),
        email: null,
        phone,
        password: 'N/A',
        userType: UserType.MEMBER,
        role: Role.USER,
        memberStatus: MemberStatus.INACTIVE,
        onboardingStatus: MemberOnboardingStatus.AWAITING_MANDATE,
        registrationDate: dto.registrationDate
          ? new Date(dto.registrationDate)
          : new Date(),
        dob: dto.dob ? new Date(dto.dob) : null,
        trainingType: (dto.trainingType as any) || null,
        trainerId: (dto.trainerId as any) || null,
        salesPersonId: (dto.salesPersonId as any) || null,
        idNo,
        companyId,
        locationId: dto.locationId,
      } as any);
    }

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const creds = await this.paymentProvider.getCredentials(companyId);
    const link = await this.razorpay.createPaymentLink(creds, {
      amountPaise: Math.round(received * 100),
      customer: { name: draft.name, contact: phone },
      description: `${plan.name} — ${enableAutopay ? 'UPI Autopay setup' : 'Membership payment'}`,
      enableAutopay,
      notes: {
        companyId,
        sessionId,
        draftMemberId: String(draft._id),
        planId: String(plan._id),
        enableAutopay: enableAutopay ? '1' : '0',
      },
    });

    const wa = await this.whatsapp.sendPaymentTemplate({
      companyId,
      phone,
      memberName: draft.name,
      amount: received,
      payUrl: link.shortUrl,
      gymName: (settings as any).gymName || undefined,
      checkoutSessionId: sessionId,
    });

    const session = await this.sessionModel.create({
      companyId,
      locationId: dto.locationId,
      sessionId,
      draftMemberId: draft._id,
      planId: plan._id,
      amount,
      receivedIntent: received,
      startDate,
      expiryDate,
      status: enableAutopay
        ? CheckoutSessionStatus.MANDATE_PENDING
        : CheckoutSessionStatus.PENDING,
      enableAutopay,
      razorpayCustomerId: link.customerId,
      razorpayOrderId: link.orderId,
      razorpayPaymentLinkId: link.id,
      shareUrl: link.shortUrl,
      qrData: link.qrData,
      whatsappUrl: wa.shareUrl,
      whatsappMode: wa.mode,
      whatsappSent: wa.sent,
      whatsappToPhone: wa.toPhone,
      idempotencyKey: dto.idempotencyKey || null,
      expiresAt,
      createdByUserId: staffUserId,
    });

    if (link.customerId) {
      draft.rzpCustomerId = link.customerId;
      await draft.save();
    }

    return this.toClient(session);
  }

  async getSession(companyId: string, sessionId: string) {
    const session = await this.sessionModel
      .findOne({ companyId, sessionId })
      .exec();
    if (!session) throw new NotFoundException('Checkout session not found');
    if (
      session.status !== CheckoutSessionStatus.PAID &&
      session.expiresAt < new Date()
    ) {
      session.status = CheckoutSessionStatus.EXPIRED;
      await session.save();
    }
    return this.toClient(session);
  }

  async resend(companyId: string, sessionId: string) {
    const session = await this.sessionModel
      .findOne({ companyId, sessionId })
      .exec();
    if (!session) throw new NotFoundException('Checkout session not found');
    if (session.status === CheckoutSessionStatus.PAID) {
      throw new BadRequestException('Checkout already completed');
    }

    const member = await this.userModel.findById(session.draftMemberId).exec();
    if (!member?.phone) throw new BadRequestException('Member phone missing');

    const companyAutopayOn = await this.gymSettings.isAutopayEnabled(companyId);
    const enableAutopay = companyAutopayOn && session.enableAutopay;

    const creds = await this.paymentProvider.getCredentials(companyId);
    const link = await this.razorpay.createPaymentLink(creds, {
      amountPaise: Math.round(session.receivedIntent * 100),
      customer: { name: member.name, contact: member.phone },
      description: 'Membership payment (resent)',
      enableAutopay,
      notes: {
        companyId,
        sessionId: session.sessionId,
        draftMemberId: String(member._id),
      },
    });

    const wa = await this.whatsapp.sendPaymentTemplate({
      companyId,
      phone: member.phone,
      memberName: member.name,
      amount: session.receivedIntent,
      payUrl: link.shortUrl,
      checkoutSessionId: session.sessionId,
    });

    session.shareUrl = link.shortUrl;
    session.qrData = link.qrData;
    session.whatsappUrl = wa.shareUrl;
    session.whatsappMode = wa.mode;
    session.whatsappSent = wa.sent;
    session.whatsappToPhone = wa.toPhone;
    session.razorpayPaymentLinkId = link.id;
    session.razorpayOrderId = link.orderId || session.razorpayOrderId;
    session.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    session.enableAutopay = enableAutopay;
    session.status = enableAutopay
      ? CheckoutSessionStatus.MANDATE_PENDING
      : CheckoutSessionStatus.PENDING;
    session.failureReason = null;
    await session.save();
    return this.toClient(session);
  }

  async cancel(companyId: string, sessionId: string) {
    const session = await this.sessionModel
      .findOne({ companyId, sessionId })
      .exec();
    if (!session) throw new NotFoundException('Checkout session not found');
    if (session.status === CheckoutSessionStatus.PAID) {
      throw new BadRequestException('Cannot cancel a paid checkout');
    }
    session.status = CheckoutSessionStatus.CANCELLED;
    await session.save();
    return this.toClient(session);
  }

  /**
   * Idempotent finalizer called from Razorpay webhook (or mock pay).
   */
  async finalizeFromWebhook(input: {
    companyId: string;
    sessionId?: string;
    orderId?: string;
    paymentLinkId?: string;
    paymentId: string;
    tokenId?: string | null;
    customerId?: string | null;
  }) {
    let session: CheckoutSessionDocument | null = null;
    if (input.sessionId) {
      session = await this.sessionModel
        .findOne({ companyId: input.companyId, sessionId: input.sessionId })
        .exec();
    }
    if (!session && input.paymentLinkId) {
      session = await this.sessionModel
        .findOne({
          companyId: input.companyId,
          razorpayPaymentLinkId: input.paymentLinkId,
        })
        .exec();
    }
    if (!session && input.orderId) {
      session = await this.sessionModel
        .findOne({
          companyId: input.companyId,
          razorpayOrderId: input.orderId,
        })
        .exec();
    }
    if (!session) {
      this.logger.warn(
        `No checkout session for webhook payment ${input.paymentId}`,
      );
      return { ok: false, reason: 'session_not_found' };
    }

    if (session.status === CheckoutSessionStatus.PAID) {
      return { ok: true, alreadyPaid: true, sessionId: session.sessionId };
    }

    const member = await this.userModel
      .findOne({
        _id: session.draftMemberId,
        companyId: input.companyId,
        userType: UserType.MEMBER,
      })
      .exec();
    if (!member) throw new NotFoundException('Draft member missing');

    if (input.customerId) {
      member.rzpCustomerId = input.customerId;
    }

    const plan = await this.planModel
      .findOne({ _id: session.planId, companyId: input.companyId })
      .exec();
    if (!plan) throw new NotFoundException('Plan missing');

    // Create subscription if needed
    let subscription = session.subscriptionId
      ? await this.subModel.findById(session.subscriptionId).exec()
      : null;

    if (!subscription) {
      subscription = await this.subModel.create({
        companyId: input.companyId,
        locationId: session.locationId,
        memberId: member._id,
        planId: plan._id,
        startDate: session.startDate,
        expiryDate: session.expiryDate,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        planPrice: session.amount,
        totalPaid: 0,
        pendingAmount: session.amount,
        paymentStatus: PaymentStatus.UNPAID,
        billingMode: session.enableAutopay
          ? BillingMode.AUTOPAY
          : BillingMode.MANUAL,
        renewalFollowUpStatus: RenewalFollowUpStatus.PENDING,
      } as any);
      session.subscriptionId = subscription._id as any;
    }

    member.memberStatus = MemberStatus.ACTIVE;
    member.onboardingStatus = MemberOnboardingStatus.ACTIVE;
    member.currentSubscriptionId = subscription._id as any;
    await member.save();

    // Mandate
    let mandate: PaymentMandateDocument | null = null;
    if (session.enableAutopay && input.tokenId) {
      mandate = await this.mandateModel.findOneAndUpdate(
        { companyId: input.companyId, tokenId: input.tokenId },
        {
          companyId: input.companyId,
          memberId: member._id,
          subscriptionId: subscription._id,
          tokenId: input.tokenId,
          maxAmount: session.amount,
          frequency: 'as_presented',
          status: MandateStatus.ACTIVE,
          nextChargeAt: session.expiryDate,
        },
        { upsert: true, returnDocument: 'after' },
      );
      subscription.mandateId = mandate!._id as any;
      subscription.billingMode = BillingMode.AUTOPAY;
      await subscription.save();
      session.razorpayTokenId = input.tokenId;
    }

    // Ledger payment (idempotent via providerRef)
    const existingPay = await this.paymentsService.findByProviderRef?.(
      input.companyId,
      input.paymentId,
    );
    let paymentId = existingPay ? String(existingPay._id) : null;

    if (!paymentId) {
      const staffId = session.createdByUserId
        ? String(session.createdByUserId)
        : String(member._id);
      const payment = await this.paymentsService.createFromProvider({
        companyId: input.companyId,
        locationId: String(session.locationId),
        memberId: String(member._id),
        subscriptionId: String(subscription._id),
        amount: session.receivedIntent,
        paymentMode: PaymentMode.ONLINE,
        paymentDate: new Date().toISOString().slice(0, 10),
        providerRef: input.paymentId,
        source: PaymentSource.CHECKOUT,
        receivedById: staffId,
        notes: session.enableAutopay
          ? 'Online checkout + UPI Autopay mandate'
          : 'Online checkout payment',
      });
      paymentId = String(payment._id);
    }

    session.paymentId = paymentId as any;
    session.razorpayPaymentId = input.paymentId;
    session.status = CheckoutSessionStatus.PAID;
    session.failureReason = null;
    await session.save();

    return {
      ok: true,
      sessionId: session.sessionId,
      memberId: String(member._id),
      subscriptionId: String(subscription._id),
      paymentId,
      mandateId: mandate ? String(mandate._id) : null,
    };
  }

  async markFailed(companyId: string, sessionId: string, reason: string) {
    await this.sessionModel.updateOne(
      { companyId, sessionId },
      {
        status: CheckoutSessionStatus.FAILED,
        failureReason: reason,
      },
    );
  }

  async findDueAutopaySubscriptions(now = new Date()) {
    return this.subModel
      .find({
        billingMode: BillingMode.AUTOPAY,
        subscriptionStatus: {
          $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRING_SOON],
        },
        expiryDate: { $lte: now },
        mandateId: { $ne: null },
      })
      .exec();
  }

  private toClient(session: CheckoutSessionDocument) {
    return {
      sessionId: session.sessionId,
      status: session.status,
      draftMemberId: String(session.draftMemberId),
      planId: String(session.planId),
      amount: session.amount,
      receivedIntent: session.receivedIntent,
      enableAutopay: session.enableAutopay,
      shareUrl: session.shareUrl,
      qrData: session.qrData,
      whatsappUrl: session.whatsappUrl,
      whatsappMode: session.whatsappMode || 'wa_me',
      whatsappSent: !!session.whatsappSent,
      whatsappToPhone: session.whatsappToPhone || null,
      expiresAt: session.expiresAt,
      failureReason: session.failureReason,
      subscriptionId: session.subscriptionId
        ? String(session.subscriptionId)
        : null,
      paymentId: session.paymentId ? String(session.paymentId) : null,
      createdAt: (session as any).createdAt,
    };
  }
}
