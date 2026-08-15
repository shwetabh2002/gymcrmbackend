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
import {
  RAZORPAY_PAYMENT_STATUS,
  toMinorUnits,
} from '../config/razorpay.config';
import { computePeriodAmount } from '../config/platform-billing.config';
import { toUnixSeconds } from '../config/time.constants';
import { CHECKOUT_LINK_TTL_MS } from '../config/autopay.config';

/** Mandate headroom for our own fees: a gym may add branches mid-term. */
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
    @InjectModel(Company.name) private companyModel: Model<CompanyDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /**
   * Our own Razorpay keys — separate from anything a gym connects.
   * Falls back to mock outside production so the whole flow is testable.
   */
  private credentials(): RazorpayCredentials {
    const keyId = (
      this.config.get<string>('PLATFORM_RAZORPAY_KEY_ID') || ''
    ).trim();
    const keySecret = (
      this.config.get<string>('PLATFORM_RAZORPAY_KEY_SECRET') || ''
    ).trim();

    if (keyId && keySecret) return { mode: 'api_keys', keyId, keySecret };

    if (this.runtime.mockAllowed()) return { mode: 'mock' };

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

  /**
   * Creates the mandate registration link a gym owner approves to start paying.
   * The first debit is the first period, so approving the mandate and paying
   * happen in one step — exactly like a member joining a gym.
   */
  async startMandate(companyId: string) {
    const sub = await this.billing.getSubscription(companyId);
    const plan = await this.plans.findById(String(sub.planId));
    if (!plan) throw new BadRequestException('Plan missing for this gym');

    const company = await this.companyModel.findById(companyId).lean().exec();
    const owner = await this.userModel
      .findOne({ companyId, role: 'ADMIN' })
      .select('name email phone')
      .lean()
      .exec();

    if (!owner?.phone && !owner?.email) {
      throw new BadRequestException(
        'Add a phone number or email on the gym owner account first',
      );
    }

    const branches = await this.billing.countBranches(companyId);
    const amount = computePeriodAmount({
      pricePerBranch: sub.pricePerBranch,
      branches,
      interval: sub.interval,
    });
    const taxPct = this.runtime.platformTaxPercentage();
    const firstCharge = Math.round(amount * (1 + taxPct / 100));

    const creds = this.credentials();
    const expireAt = new Date();
    expireAt.setMonth(expireAt.getMonth() + PLATFORM_MANDATE_MONTHS);

    const link = await this.razorpay.createAuthorizationLink(creds, {
      amountPaise: toMinorUnits(firstCharge),
      customer: {
        name: (company as any)?.name || 'Gym',
        contact: owner?.phone || '',
        ...(owner?.email ? { email: owner.email } : {}),
      },
      description: `${plan.name} subscription — ${branches} branch${branches === 1 ? '' : 'es'}`,
      // Headroom so adding branches mid-term does not need re-approval.
      maxAmountPaise: toMinorUnits(firstCharge * PLATFORM_MANDATE_MULTIPLIER),
      mandateExpireAt: toUnixSeconds(expireAt),
      linkExpireAt: toUnixSeconds(new Date(Date.now() + CHECKOUT_LINK_TTL_MS)),
      method: 'upi',
      notes: {
        platformBilling: '1',
        companyId: String(companyId),
        planCode: sub.planCode,
      },
    });

    await this.billing.setPendingMandate(companyId, {
      authLinkId: link.id,
      shareUrl: link.shortUrl,
      customerId: link.customerId,
    });

    return {
      shareUrl: link.shortUrl,
      qrData: link.qrData,
      amount: firstCharge,
      currency: sub.currency,
      branches,
      planCode: sub.planCode,
      expiresAt: new Date(Date.now() + CHECKOUT_LINK_TTL_MS),
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

    try {
      const creds = this.credentials();
      const result = await this.razorpay.chargeToken(creds, {
        amountPaise: toMinorUnits(charge.totalAmount),
        tokenId: sub.mandateTokenId,
        customerId: sub.mandateCustomerId || '',
        receipt: charge.invoiceNumber,
        email: owner?.email || this.runtime.systemEmail(),
        contact: owner?.phone || '',
        notes: {
          platformBilling: '1',
          companyId,
          chargeId: String(charge._id),
          invoiceNumber: charge.invoiceNumber,
        },
      });

      if (result.status === RAZORPAY_PAYMENT_STATUS.captured) {
        await this.billing.markChargePaid(sub, charge, result.paymentId);
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
    tokenId?: string | null;
    customerId?: string | null;
    succeeded: boolean;
    reason?: string;
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
    const charge =
      existing ||
      (input.chargeId ? await this.billing.findCharge(input.chargeId) : null);

    if (!charge) {
      // The first debit rides along with mandate approval and has no charge row
      // yet — open one for the period it just paid for.
      if (input.succeeded) {
        const fresh = await this.billing.getSubscription(input.companyId);
        const branches = await this.billing.countBranches(input.companyId);
        const opened = await this.billing.openCharge(fresh, branches);
        await this.billing.markChargePaid(fresh, opened, input.paymentId);
        return { ok: true, handled: 'first_charge' };
      }
      return { ok: false, reason: 'charge_not_found' };
    }

    if (charge.status === 'PAID') {
      return { ok: true, handled: 'already_paid' };
    }

    if (input.succeeded) {
      await this.billing.markChargePaid(sub, charge, input.paymentId);
      return { ok: true, handled: 'charge_paid' };
    }

    await this.billing.markChargeFailed(
      sub,
      charge,
      input.reason || 'Payment failed',
    );
    return { ok: true, handled: 'charge_failed' };
  }
}
