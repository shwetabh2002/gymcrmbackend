import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  RazorpayApiService,
  RazorpayCredentials,
} from '../payment-provider/razorpay-api.service';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformPlansService } from './platform-plans.service';
import { PlatformSubscriptionDocument } from './schemas/platform-subscription.schema';
import { Company, CompanyDocument } from '../companies/schemas/company.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { RuntimeService } from '../common/runtime/runtime.service';
import { CompanyContextService } from '../common/company-context/company-context.service';
import {
  RAZORPAY_PAYMENT_STATUS,
  toMinorUnits,
} from '../config/razorpay.config';
import { computePeriodAmount } from '../config/platform-billing.config';
import { toUnixSeconds } from '../config/time.constants';
import { CHECKOUT_LINK_TTL_MS } from '../config/autopay.config';

/** Mandate headroom for our fees: a gym may add branches mid-term. */
const PLATFORM_MANDATE_MULTIPLIER = 4;
const PLATFORM_MANDATE_MONTHS = 60;

/**
 * Collects the platform's fee from a gym.
 *
 * Deliberately the same mechanism the gyms use on their own members: a UPI
 * Autopay mandate taken at signup, then charged each period. It runs on the
 * platform's own Razorpay account, never on the gym's connected one — that
 * account is for the gym's money.
 */
@Injectable()
export class PlatformChargingService {
  private readonly logger = new Logger(PlatformChargingService.name);

  constructor(
    private razorpay: RazorpayApiService,
    private billing: PlatformBillingService,
    private plans: PlatformPlansService,
    private config: ConfigService,
    private runtime: RuntimeService,
    private companyContext: CompanyContextService,
    @InjectModel(Company.name) private companyModel: Model<CompanyDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /**
   * Razorpay recurring auth links require a non-empty contact (phone).
   * Prefer admin phone, then company phone from signup.
   */
  private async resolveBillingContact(
    companyId: string,
    company: { phone?: string | null } | null,
    owner: { phone?: string | null } | null,
  ): Promise<string> {
    const raw = (owner?.phone || company?.phone || '').trim();
    const contact = raw
      ? await this.companyContext.normalizePhone(companyId, raw)
      : '';
    if (!contact || contact.replace(/\D/g, '').length < 10) {
      throw new BadRequestException(
        'Add a phone number on the gym owner account (or company phone) before billing — Razorpay needs it',
      );
    }
    return contact;
  }

  private async loadBillingCustomer(companyId: string) {
    const sub = await this.billing.getSubscription(companyId);
    const plan = await this.plans.findById(String(sub.planId));
    if (!plan) throw new BadRequestException('Plan missing for this gym');

    const company = await this.companyModel.findById(companyId).lean().exec();
    const owner = await this.userModel
      .findOne({ companyId, role: 'ADMIN' })
      .select('name email phone')
      .lean()
      .exec();

    const contact = await this.resolveBillingContact(
      companyId,
      company as any,
      owner as any,
    );

    const branches = await this.billing.countBranches(companyId);
    const amount = computePeriodAmount({
      pricePerBranch: sub.pricePerBranch,
      branches,
      interval: sub.interval,
    });
    const taxPct = this.runtime.platformTaxPercentage();
    const firstCharge = Math.round(amount * (1 + taxPct / 100));

    return {
      sub,
      plan,
      company,
      owner,
      contact,
      branches,
      firstCharge,
    };
  }

  /**
   * Start platform fee collection.
   * - one_time → Razorpay payment link (pay this period once)
   * - autopay  → UPI Autopay mandate registration (first debit + token)
   */
  async startBilling(
    companyId: string,
    mode: 'one_time' | 'autopay' = 'one_time',
  ) {
    if (mode === 'autopay') return this.startAutopayMandate(companyId);
    return this.startOneTimePayment(companyId);
  }

  private credentials(): RazorpayCredentials {
    const keyId = (
      this.config.get<string>('PLATFORM_RAZORPAY_KEY_ID') || ''
    ).trim();
    const keySecret = (
      this.config.get<string>('PLATFORM_RAZORPAY_KEY_SECRET') || ''
    ).trim();

    if (keyId && keySecret) return { mode: 'api_keys', keyId, keySecret };

    throw new BadRequestException(
      'Platform billing is not configured — set PLATFORM_RAZORPAY_KEY_ID and PLATFORM_RAZORPAY_KEY_SECRET',
    );
  }

  isConfigured(): boolean {
    try {
      this.credentials();
      return true;
    } catch {
      return false;
    }
  }

  /** @deprecated Prefer startBilling(mode) — kept for older clients. */
  async startMandate(companyId: string) {
    return this.startBilling(companyId, 'one_time');
  }

  private async startOneTimePayment(companyId: string) {
    const { sub, plan, company, owner, contact, branches, firstCharge } =
      await this.loadBillingCustomer(companyId);

    const charge = await this.billing.openCharge(sub, branches);
    const creds = this.credentials();
    if (creds.mode !== 'api_keys') {
      throw new BadRequestException('Platform Razorpay API keys required');
    }

    const notes = {
      platformBilling: '1',
      companyId: String(companyId),
      planCode: sub.planCode,
      chargeId: String(charge._id),
      payMode: 'one_time',
    };

    const order = await this.razorpay.createOrder(creds, {
      amountPaise: toMinorUnits(firstCharge),
      currency: sub.currency || 'INR',
      receipt: charge.invoiceNumber,
      notes,
    });

    charge.providerRef = order.orderId;
    charge.razorpayOrderId = order.orderId;
    charge.payMode = 'one_time';
    charge.amountPaise = order.amountPaise;
    charge.providerStatus = 'created';
    await charge.save();

    return {
      mode: 'one_time' as const,
      checkout: true as const,
      orderId: order.orderId,
      keyId: creds.keyId,
      amount: firstCharge,
      amountPaise: order.amountPaise,
      currency: order.currency,
      branches,
      planCode: sub.planCode,
      chargeId: String(charge._id),
      description: `${plan.name} — 1 ${sub.interval === 'YEARLY' ? 'year' : 'month'}`,
      prefill: {
        name: (company as any)?.name || owner?.name || 'Gym',
        email: owner?.email || undefined,
        contact,
      },
      // No hosted redirect — Checkout.js opens on the CRM page.
      shareUrl: null as string | null,
      qrData: null as string | null,
      expiresAt: new Date(Date.now() + CHECKOUT_LINK_TTL_MS),
    };
  }

  /**
   * After Checkout.js success: verify signature and mark the period paid.
   * Webhook remains the backup path.
   */
  async verifyCheckoutPayment(
    companyId: string,
    input: {
      orderId: string;
      paymentId: string;
      signature: string;
      chargeId?: string | null;
    },
  ) {
    const creds = this.credentials();
    if (creds.mode !== 'api_keys') {
      throw new BadRequestException('Platform Razorpay API keys required');
    }
    const ok = this.razorpay.verifyCheckoutSignature(
      input.orderId,
      input.paymentId,
      input.signature,
      creds.keySecret,
    );
    if (!ok) {
      throw new BadRequestException('Invalid payment signature');
    }

    let chargeId = input.chargeId || null;
    if (!chargeId) {
      const byOrder = await this.billing.findChargeByOrderId(input.orderId);
      if (byOrder && String(byOrder.companyId) === String(companyId)) {
        chargeId = String(byOrder._id);
      }
    } else {
      const charge = await this.billing.findCharge(chargeId);
      if (!charge || String(charge.companyId) !== String(companyId)) {
        throw new BadRequestException('Charge does not belong to this gym');
      }
    }

    return this.settleFromWebhook({
      companyId,
      paymentId: input.paymentId,
      chargeId,
      orderId: input.orderId,
      signature: input.signature,
      tokenId: null,
      customerId: null,
      succeeded: true,
      payMode: 'one_time',
    });
  }

  private async startAutopayMandate(companyId: string) {
    const { sub, plan, company, owner, contact, branches, firstCharge } =
      await this.loadBillingCustomer(companyId);

    const creds = this.credentials();
    const expireAt = new Date();
    expireAt.setMonth(expireAt.getMonth() + PLATFORM_MANDATE_MONTHS);

    const link = await this.razorpay.createAuthorizationLink(creds, {
      amountPaise: toMinorUnits(firstCharge),
      customer: {
        name: (company as any)?.name || owner?.name || 'Gym',
        contact,
        ...(owner?.email ? { email: owner.email } : {}),
      },
      description: `${plan.name} Autopay — ${branches} branch${branches === 1 ? '' : 'es'}`,
      maxAmountPaise: toMinorUnits(firstCharge * PLATFORM_MANDATE_MULTIPLIER),
      mandateExpireAt: toUnixSeconds(expireAt),
      linkExpireAt: toUnixSeconds(new Date(Date.now() + CHECKOUT_LINK_TTL_MS)),
      method: 'upi',
      notes: {
        platformBilling: '1',
        companyId: String(companyId),
        planCode: sub.planCode,
        payMode: 'autopay',
      },
    });

    await this.billing.setPendingMandate(companyId, {
      authLinkId: link.id,
      shareUrl: link.shortUrl,
      customerId: link.customerId,
    });

    return {
      shareUrl: link.shortUrl,
      qrData: link.shortUrl,
      amount: firstCharge,
      currency: sub.currency,
      branches,
      planCode: sub.planCode,
      expiresAt: new Date(Date.now() + CHECKOUT_LINK_TTL_MS),
      mode: 'autopay' as const,
    };
  }

  /**
   * Debits one period against the gym's mandate.
   *
   * Opens the charge row first so a failure is on record, then reflects the
   * outcome. A mandate that is missing is a failure like any other — it is what
   * dunning exists for.
   */
  async chargeSubscription(
    sub: PlatformSubscriptionDocument,
  ): Promise<'charged' | 'pending' | 'failed'> {
    const companyId = String(sub.companyId);

    if (!sub.mandateTokenId) {
      await this.billing.markChargeFailed(
        sub,
        null,
        'No payment mandate approved yet',
      );
      return 'failed';
    }

    const branches = await this.billing.countBranches(companyId);
    const charge = await this.billing.openCharge(sub, branches);

    const owner = await this.userModel
      .findOne({ companyId, role: 'ADMIN' })
      .select('email phone')
      .lean()
      .exec();
    const company = await this.companyModel
      .findById(companyId)
      .select('phone')
      .lean()
      .exec();
    const contact = await this.resolveBillingContact(
      companyId,
      company as any,
      owner as any,
    );

    try {
      const creds = this.credentials();
      const result = await this.razorpay.chargeToken(creds, {
        amountPaise: toMinorUnits(charge.totalAmount),
        tokenId: sub.mandateTokenId,
        customerId: sub.mandateCustomerId || '',
        receipt: charge.invoiceNumber,
        email: owner?.email || this.runtime.systemEmail(),
        contact,
        notes: {
          platformBilling: '1',
          companyId,
          chargeId: String(charge._id),
          invoiceNumber: charge.invoiceNumber,
        },
      });

      if (result.status === RAZORPAY_PAYMENT_STATUS.captured) {
        await this.billing.markChargePaid(sub, charge, result.paymentId, {
          orderId: result.orderId,
          paymentId: result.paymentId,
          payMode: 'autopay',
          providerStatus: result.status,
          customerId: sub.mandateCustomerId,
        });
        this.logger.log(
          `Charged ${charge.currency} ${charge.totalAmount} to company ${companyId} (${charge.invoiceNumber})`,
        );
        return 'charged';
      }

      if (result.status === RAZORPAY_PAYMENT_STATUS.failed) {
        await this.billing.markChargeFailed(
          sub,
          charge,
          `Razorpay returned ${result.status}`,
        );
        return 'failed';
      }

      // Accepted but not captured — the webhook settles it.
      charge.providerRef = result.paymentId;
      charge.razorpayPaymentId = result.paymentId;
      charge.razorpayOrderId = result.orderId || charge.razorpayOrderId;
      charge.payMode = 'autopay';
      charge.providerStatus = result.status;
      await charge.save();
      this.logger.log(
        `Platform charge ${charge.invoiceNumber} awaiting capture (${result.paymentId})`,
      );
      return 'pending';
    } catch (err) {
      await this.billing.markChargeFailed(
        sub,
        charge,
        err instanceof Error ? err.message : String(err),
      );
      return 'failed';
    }
  }

  /** Settles a charge the provider confirmed asynchronously. */
  async settleFromWebhook(input: {
    companyId: string;
    paymentId: string;
    chargeId?: string | null;
    orderId?: string | null;
    signature?: string | null;
    tokenId?: string | null;
    customerId?: string | null;
    succeeded: boolean;
    reason?: string;
    payMode?: string | null;
  }) {
    const sub = await this.billing.getSubscription(input.companyId);

    // A mandate approval arrives with a token; record it before anything else
    // so the gym is billable even if the first capture lands separately.
    if (input.tokenId && !sub.mandateTokenId) {
      await this.billing.attachMandate(input.companyId, {
        tokenId: input.tokenId,
        customerId: input.customerId,
      });
    }

    const existing = await this.billing.findChargeByProviderRef(input.paymentId);
    const byOrder =
      !existing && input.orderId
        ? await this.billing.findChargeByOrderId(input.orderId)
        : null;
    const charge =
      existing ||
      byOrder ||
      (input.chargeId ? await this.billing.findCharge(input.chargeId) : null);

    // Pull the live payment object so method / VPA / order id are on our ledger.
    let fetched: Awaited<ReturnType<RazorpayApiService['fetchPayment']>> = null;
    if (input.succeeded && input.paymentId?.startsWith('pay_')) {
      try {
        const creds = this.credentials();
        fetched = await this.razorpay.fetchPayment(creds, input.paymentId);
      } catch {
        fetched = null;
      }
    }

    const paymentMeta = {
      orderId: input.orderId || fetched?.orderId || null,
      paymentId: input.paymentId || fetched?.paymentId || null,
      signature: input.signature || null,
      payMode:
        input.payMode ||
        fetched?.notes?.payMode ||
        (input.tokenId || sub.mandateTokenId ? 'autopay' : 'one_time'),
      method: fetched?.method || null,
      customerId:
        input.customerId || fetched?.customerId || sub.mandateCustomerId || null,
      email: fetched?.email || null,
      contact: fetched?.contact || null,
      instrument: fetched?.instrument || null,
      amountPaise: fetched?.amountPaise ?? null,
      providerStatus: fetched?.status || (input.succeeded ? 'captured' : null),
      paidAt: fetched?.capturedAt || null,
    };

    if (!charge) {
      // The first debit rides along with mandate approval and has no charge row
      // yet — open one for the period it just paid for.
      if (input.succeeded) {
        const fresh = await this.billing.getSubscription(input.companyId);
        const branches = await this.billing.countBranches(input.companyId);
        const opened = await this.billing.openCharge(fresh, branches);
        await this.billing.markChargePaid(
          fresh,
          opened,
          input.paymentId,
          paymentMeta,
        );
        return { ok: true, handled: 'first_charge' };
      }
      return { ok: false, reason: 'charge_not_found' };
    }

    if (charge.status === 'PAID') {
      // Backfill Razorpay fields if an older settle only stored providerRef.
      if (!charge.razorpayPaymentId && paymentMeta.paymentId) {
        charge.razorpayPaymentId = paymentMeta.paymentId;
        if (paymentMeta.orderId) charge.razorpayOrderId = paymentMeta.orderId;
        if (paymentMeta.signature) charge.razorpaySignature = paymentMeta.signature;
        if (paymentMeta.payMode) charge.payMode = paymentMeta.payMode;
        if (paymentMeta.method) charge.paymentMethod = paymentMeta.method;
        if (paymentMeta.customerId) {
          charge.razorpayCustomerId = paymentMeta.customerId;
        }
        if (paymentMeta.email) charge.payerEmail = paymentMeta.email;
        if (paymentMeta.contact) charge.payerContact = paymentMeta.contact;
        if (paymentMeta.instrument) {
          charge.paymentInstrument = paymentMeta.instrument;
        }
        if (paymentMeta.amountPaise != null) {
          charge.amountPaise = paymentMeta.amountPaise;
        }
        if (paymentMeta.providerStatus) {
          charge.providerStatus = paymentMeta.providerStatus;
        }
        await charge.save();
      }
      return { ok: true, handled: 'already_paid' };
    }

    if (input.succeeded) {
      await this.billing.markChargePaid(
        sub,
        charge,
        input.paymentId,
        paymentMeta,
      );
      return { ok: true, handled: 'charge_paid' };
    }

    await this.billing.markChargeFailed(
      sub,
      charge,
      input.reason || fetched?.errorDescription || 'Payment failed',
    );
    return { ok: true, handled: 'charge_failed' };
  }
}
