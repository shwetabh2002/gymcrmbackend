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
import {
  MemberOnboardingStatus,
  BillingMode,
  MandateStatus,
  PaymentSource,
} from '../common/enums/billing.enum';
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
import { MemberSubscriptionsService } from '../member-subscriptions/member-subscriptions.service';
import { EmailTemplatesService } from '../email/email-templates.service';
import { EMAIL_TYPES } from '../config/email-templates.config';
import { CompanyContextService } from '../common/company-context/company-context.service';
import { RenewalFollowUpStatus } from '../common/enums/renewal-follow-up-status.enum';
import {
  CHECKOUT_LINK_TTL_MS,
  DEFAULT_MANDATE_MULTIPLIER,
  DEFAULT_MANDATE_VALIDITY_MONTHS,
} from '../config/autopay.config';
import {
  DEFAULT_MANDATE_METHOD,
  MANDATE_MAX_AMOUNT_BY_METHOD,
  MandateMethod,
  isMandateMethod,
  toMinorUnits,
} from '../config/razorpay.config';
import {
  CHARGE_KINDS,
  PAYMENT_NOTE_KEYS,
  noteFlag,
} from '../config/payment-notes.config';
import { toUnixSeconds } from '../config/time.constants';

/**
 * Terms the member sees and approves once: the most that may ever be debited in
 * one go, and how long the mandate lives. Both are per-gym configurable.
 */
export function resolveMandateTerms(
  planPrice: number,
  settings: any,
): { maxAmount: number; expireAt: Date; method: MandateMethod } {
  const multiplier =
    Number(settings?.autopayMandateMultiplier) > 0
      ? Number(settings.autopayMandateMultiplier)
      : DEFAULT_MANDATE_MULTIPLIER;
  const months =
    Number(settings?.autopayMandateValidityMonths) > 0
      ? Number(settings.autopayMandateValidityMonths)
      : DEFAULT_MANDATE_VALIDITY_MONTHS;
  const method = isMandateMethod(settings?.autopayMethod)
    ? settings.autopayMethod
    : DEFAULT_MANDATE_METHOD;

  // Never ask for more headroom than the instrument's scheme allows.
  const requested = Math.ceil(Math.max(Number(planPrice) || 0, 1) * multiplier);
  const schemeCap = MANDATE_MAX_AMOUNT_BY_METHOD[method];
  const maxAmount = schemeCap ? Math.min(requested, schemeCap) : requested;

  const expireAt = new Date();
  expireAt.setMonth(expireAt.getMonth() + months);

  return { maxAmount, expireAt, method };
}

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
    private emailTemplates: EmailTemplatesService,
    private companyContext: CompanyContextService,
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
    if (
      phoneClash &&
      phoneClash.onboardingStatus === MemberOnboardingStatus.ACTIVE
    ) {
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
    const expiryDate = dto.expiryDate
      ? new Date(dto.expiryDate)
      : MemberSubscriptionsService.addPlanDuration(
          startDate,
          plan.duration,
          plan.durationType,
        );

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
      if (dto.email?.trim()) draft.email = dto.email.trim().toLowerCase();
      draft.locationId = new Types.ObjectId(dto.locationId) as any;
      await draft.save();
    } else {
      draft = await this.userModel.create({
        name: dto.name.trim(),
        email: dto.email?.trim().toLowerCase() || null,
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
    const expiresAt = new Date(Date.now() + CHECKOUT_LINK_TTL_MS);

    const link = await this.createProviderLink({
      companyId,
      sessionId,
      enableAutopay,
      amount: received,
      planPrice: amount,
      planName: plan.name,
      member: {
        id: String(draft._id),
        name: draft.name,
        phone,
        email: draft.email || undefined,
        rzpCustomerId: draft.rzpCustomerId || null,
      },
      planId: String(plan._id),
      settings,
      linkExpiresAt: expiresAt,
    });

    // Both notifications are opt-out from the member form; default is on.
    const wantsWhatsApp = dto.sendWhatsApp !== false;
    const wantsEmail = dto.sendEmail !== false;

    const wa = await this.whatsapp.sendPaymentTemplate({
      companyId,
      phone,
      memberName: draft.name,
      amount: received,
      payUrl: link.shortUrl,
      gymName: (settings as any).gymName || undefined,
      checkoutSessionId: sessionId,
      send: wantsWhatsApp,
    });

    const emailResult = await this.emailTemplates.sendTemplated({
      companyId,
      type: EMAIL_TYPES.paymentLink,
      to: draft.email,
      send: wantsEmail,
      vars: {
        memberName: draft.name,
        planName: plan.name,
        amount: await this.companyContext.formatMoney(companyId, received),
        payUrl: link.shortUrl,
      },
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
      razorpayPaymentLinkId: link.kind === 'payment_link' ? link.id : null,
      razorpayAuthLinkId: link.kind === 'auth_link' ? link.id : null,
      mandateMaxAmount: link.mandateMaxAmount,
      mandateExpireAt: link.mandateExpireAt,
      mandateMethod: link.mandateMethod,
      shareUrl: link.shortUrl,
      qrData: link.qrData,
      whatsappUrl: wa.shareUrl,
      whatsappMode: wa.mode,
      whatsappSent: wa.sent,
      whatsappToPhone: wa.toPhone,
      emailSent: emailResult.sent,
      emailToAddress: draft.email || null,
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

  /**
   * Builds the link the member actually pays on.
   *
   * autopay ON  → Razorpay *authorization link*: the member approves a UPI
   *               Autopay mandate and pays the first amount in one step. This is
   *               the only way a reusable token is created; a plain payment link
   *               never produces one.
   * autopay OFF → ordinary one-time payment link.
   */
  private async createProviderLink(input: {
    companyId: string;
    sessionId: string;
    enableAutopay: boolean;
    /** Amount to collect right now. */
    amount: number;
    /** Full plan price — drives the mandate ceiling. */
    planPrice: number;
    planName: string;
    planId: string;
    member: {
      id: string;
      name: string;
      phone: string;
      email?: string;
      rzpCustomerId?: string | null;
    };
    settings: any;
    linkExpiresAt: Date;
  }): Promise<{
    kind: 'auth_link' | 'payment_link';
    id: string;
    shortUrl: string;
    orderId: string | null;
    customerId: string | null;
    qrData: string;
    mandateMaxAmount: number | null;
    mandateExpireAt: Date | null;
    mandateMethod: string | null;
  }> {
    const creds = await this.paymentProvider.getCredentials(input.companyId);
    const notes: Record<string, string> = {
      [PAYMENT_NOTE_KEYS.companyId]: input.companyId,
      [PAYMENT_NOTE_KEYS.sessionId]: input.sessionId,
      [PAYMENT_NOTE_KEYS.draftMemberId]: input.member.id,
      [PAYMENT_NOTE_KEYS.planId]: input.planId,
      [PAYMENT_NOTE_KEYS.enableAutopay]: noteFlag(input.enableAutopay),
    };

    if (!input.enableAutopay) {
      const link = await this.razorpay.createPaymentLink(creds, {
        amountPaise: toMinorUnits(input.amount),
        customer: {
          name: input.member.name,
          contact: input.member.phone,
          ...(input.member.email ? { email: input.member.email } : {}),
        },
        description: `${input.planName} — membership payment`,
        notes,
      });
      return {
        kind: 'payment_link',
        id: link.id,
        shortUrl: link.shortUrl,
        orderId: link.orderId,
        customerId: link.customerId,
        qrData: link.qrData,
        mandateMaxAmount: null,
        mandateExpireAt: null,
        mandateMethod: null,
      };
    }

    const { maxAmount, expireAt, method } = resolveMandateTerms(
      input.planPrice,
      input.settings,
    );

    // A mandate must belong to a Razorpay customer; reuse the member's if known.
    const customerId =
      input.member.rzpCustomerId ||
      (await this.razorpay.createCustomer(creds, {
        name: input.member.name,
        contact: input.member.phone,
        email: input.member.email,
      }));

    const link = await this.razorpay.createAuthorizationLink(creds, {
      amountPaise: toMinorUnits(input.amount),
      customer: {
        name: input.member.name,
        contact: input.member.phone,
        ...(input.member.email ? { email: input.member.email } : {}),
      },
      description: `${input.planName} — UPI Autopay setup + first payment`,
      maxAmountPaise: toMinorUnits(maxAmount),
      mandateExpireAt: toUnixSeconds(expireAt),
      linkExpireAt: toUnixSeconds(input.linkExpiresAt),
      method,
      receipt: `chk_${input.sessionId.slice(0, 18)}`,
      notes: { ...notes, [PAYMENT_NOTE_KEYS.kind]: CHARGE_KINDS.mandate },
    });

    return {
      kind: 'auth_link',
      id: link.id,
      shortUrl: link.shortUrl,
      orderId: link.orderId,
      customerId: link.customerId || customerId,
      qrData: link.qrData,
      mandateMaxAmount: maxAmount,
      mandateExpireAt: expireAt,
      mandateMethod: link.method,
    };
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

    const settings = await this.gymSettings.get(companyId);
    const companyAutopayOn = settings.autopayEnabled === true;
    const enableAutopay = companyAutopayOn && session.enableAutopay;
    const plan = await this.planModel
      .findOne({ _id: session.planId, companyId })
      .exec();

    const expiresAt = new Date(Date.now() + CHECKOUT_LINK_TTL_MS);
    const link = await this.createProviderLink({
      companyId,
      sessionId: session.sessionId,
      enableAutopay,
      amount: session.receivedIntent,
      planPrice: session.amount,
      planName: plan?.name || 'Membership',
      planId: String(session.planId),
      member: {
        id: String(member._id),
        name: member.name,
        phone: member.phone,
        email: member.email || undefined,
        rzpCustomerId: member.rzpCustomerId || null,
      },
      settings,
      linkExpiresAt: expiresAt,
    });

    const wa = await this.whatsapp.sendPaymentTemplate({
      companyId,
      phone: member.phone,
      memberName: member.name,
      amount: session.receivedIntent,
      payUrl: link.shortUrl,
      gymName: (settings as any).gymName || undefined,
      checkoutSessionId: session.sessionId,
    });

    const emailResult = await this.emailTemplates.sendTemplated({
      companyId,
      type: EMAIL_TYPES.paymentLink,
      to: member.email,
      vars: {
        memberName: member.name,
        planName: plan?.name || 'Membership',
        amount: await this.companyContext.formatMoney(
          companyId,
          session.receivedIntent,
        ),
        payUrl: link.shortUrl,
      },
    });

    session.shareUrl = link.shortUrl;
    session.qrData = link.qrData;
    session.whatsappUrl = wa.shareUrl;
    session.whatsappMode = wa.mode;
    session.whatsappSent = wa.sent;
    session.whatsappToPhone = wa.toPhone;
    session.emailSent = emailResult.sent;
    session.emailToAddress = member.email || null;
    if (link.kind === 'auth_link') {
      session.razorpayAuthLinkId = link.id;
      session.mandateMaxAmount = link.mandateMaxAmount;
      session.mandateExpireAt = link.mandateExpireAt;
      session.mandateMethod = link.mandateMethod;
    } else {
      session.razorpayPaymentLinkId = link.id;
    }
    session.razorpayCustomerId = link.customerId || session.razorpayCustomerId;
    session.razorpayOrderId = link.orderId || session.razorpayOrderId;
    session.expiresAt = expiresAt;
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
    /** Mandate registration link id (inv_…) for autopay checkouts. */
    authLinkId?: string;
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
    if (!session && input.authLinkId) {
      session = await this.sessionModel
        .findOne({
          companyId: input.companyId,
          razorpayAuthLinkId: input.authLinkId,
        })
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
        cycleStartDate: session.startDate,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        planPrice: session.amount,
        totalPaid: 0,
        lifetimePaid: 0,
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

    // Mandate — only a real token makes a subscription auto-chargeable.
    let mandate: PaymentMandateDocument | null = null;
    if (session.enableAutopay && input.tokenId) {
      const customerId =
        input.customerId || session.razorpayCustomerId || member.rzpCustomerId;
      mandate = await this.mandateModel.findOneAndUpdate(
        { companyId: input.companyId, tokenId: input.tokenId },
        {
          companyId: input.companyId,
          memberId: member._id,
          subscriptionId: subscription._id,
          tokenId: input.tokenId,
          customerId: customerId || null,
          method: session.mandateMethod || 'upi',
          maxAmount: session.mandateMaxAmount ?? session.amount,
          expireAt: session.mandateExpireAt || null,
          authLinkId: session.razorpayAuthLinkId || null,
          frequency: 'as_presented',
          status: MandateStatus.ACTIVE,
          nextChargeAt: session.expiryDate,
          lastFailureReason: null,
          consecutiveFailures: 0,
        },
        { upsert: true, returnDocument: 'after' },
      );
      subscription.mandateId = mandate!._id as any;
      subscription.billingMode = BillingMode.AUTOPAY;
      await subscription.save();
      session.razorpayTokenId = input.tokenId;
    } else if (session.enableAutopay) {
      // Paid, but the mandate never came through: keep collecting manually
      // instead of pretending autopay is armed.
      subscription.billingMode = BillingMode.MANUAL;
      await subscription.save();
      this.logger.warn(
        `Checkout ${session.sessionId} paid without a mandate token — subscription left on MANUAL billing`,
      );
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
      emailSent: !!session.emailSent,
      emailToAddress: session.emailToAddress || null,
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
