import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CheckoutService } from '../checkout/checkout.service';
import { PaymentProviderService } from '../payment-provider/payment-provider.service';
import { RazorpayApiService } from '../payment-provider/razorpay-api.service';
import { MandatesService } from '../autopay/mandates.service';
import { PlatformChargingService } from '../platform-billing/platform-charging.service';
import { MandateStatus } from '../common/enums/billing.enum';
import { RuntimeService } from '../common/runtime/runtime.service';
import {
  CheckoutSession,
  CheckoutSessionDocument,
} from '../checkout/schemas/checkout-session.schema';
import {
  RAZORPAY_EVENTS,
  RAZORPAY_SIGNATURE_HEADER,
  fromMinorUnits,
} from '../config/razorpay.config';
import {
  CHARGE_KINDS,
  PAYMENT_NOTE_KEYS,
  PAYMENT_NOTE_SOURCE,
} from '../config/payment-notes.config';
import { CRM_QUERY, CRM_ROUTES } from '../config/crm-routes.config';

@Controller('webhooks/razorpay')
export class RazorpayWebhookController {
  private readonly logger = new Logger(RazorpayWebhookController.name);

  constructor(
    private checkout: CheckoutService,
    private provider: PaymentProviderService,
    private razorpay: RazorpayApiService,
    private mandates: MandatesService,
    private platformCharging: PlatformChargingService,
    private runtime: RuntimeService,
    @InjectModel(CheckoutSession.name)
    private sessionModel: Model<CheckoutSessionDocument>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Body() body: any,
    @Headers(RAZORPAY_SIGNATURE_HEADER) signature: string,
    @Req() req: any,
  ) {
    const event = body?.event as string;

    const companyId =
      (await this.provider.resolveCompanyFromWebhookPayload(body)) || null;

    // ── Authenticity first: never act on an unverified payload in production ──
    if (this.runtime.requireWebhookSignature()) {
      const raw =
        typeof req.rawBody === 'string'
          ? req.rawBody
          : Buffer.isBuffer(req.rawBody)
            ? req.rawBody.toString('utf8')
            : JSON.stringify(body || {});

      const secrets = await this.provider.resolveWebhookSecrets(companyId);
      if (!secrets.length) {
        this.logger.error(
          `Rejecting ${event}: no webhook secret configured for company ${companyId ?? 'unknown'}`,
        );
        return { ok: false, reason: 'no_webhook_secret' };
      }
      const valid = secrets.some((secret) =>
        this.razorpay.verifyWebhookSignature(raw, signature, secret),
      );
      if (!valid) {
        this.logger.warn(`Rejecting ${event}: invalid Razorpay signature`);
        return { ok: false, reason: 'invalid_signature' };
      }
    }

    this.logger.log(`Razorpay webhook: ${event}`);

    if (!companyId) {
      this.logger.warn(`Webhook ${event} missing companyId — ignored`);
      return { ok: true, skipped: true };
    }

    const paymentEntity =
      body?.payload?.payment?.entity ||
      body?.payload?.payment_link?.entity?.payments?.[0] ||
      null;
    const linkEntity = body?.payload?.payment_link?.entity || null;
    const orderEntity = body?.payload?.order?.entity || null;
    const invoiceEntity = body?.payload?.invoice?.entity || null;
    const tokenEntity = body?.payload?.token?.entity || null;
    const notes =
      paymentEntity?.notes ||
      invoiceEntity?.notes ||
      linkEntity?.notes ||
      orderEntity?.notes ||
      tokenEntity?.notes ||
      {};

    // ── Our own subscription fees, not a gym's member payment ──
    if (notes.platformBilling === '1') {
      const succeeded =
        event === RAZORPAY_EVENTS.paymentCaptured ||
        event === RAZORPAY_EVENTS.invoicePaid ||
        event === RAZORPAY_EVENTS.orderPaid ||
        event === RAZORPAY_EVENTS.tokenConfirmed;
      const failed =
        event === RAZORPAY_EVENTS.paymentFailed ||
        event === RAZORPAY_EVENTS.tokenRejected;

      if (!succeeded && !failed) return { ok: true, skipped: true };

      const result = await this.platformCharging.settleFromWebhook({
        companyId: String(notes.companyId || companyId),
        paymentId: paymentEntity?.id || `token_${tokenEntity?.id}`,
        chargeId: notes.chargeId || null,
        tokenId: paymentEntity?.token_id || tokenEntity?.id || null,
        customerId:
          paymentEntity?.customer_id || tokenEntity?.customer_id || null,
        succeeded,
        reason:
          paymentEntity?.error_description || (failed ? event : undefined),
      });
      return { ...result, handled: 'platform_billing' };
    }

    // ── Recurring debits initiated by our own worker ──
    if (notes[PAYMENT_NOTE_KEYS.source] === PAYMENT_NOTE_SOURCE.autopay) {
      if (event === RAZORPAY_EVENTS.paymentCaptured) {
        const result = await this.mandates.handleAutopayCapture({
          companyId,
          paymentId: paymentEntity?.id,
          amount: fromMinorUnits(paymentEntity?.amount),
          tokenId:
            paymentEntity?.token_id || notes[PAYMENT_NOTE_KEYS.tokenId] || null,
          subscriptionId: notes[PAYMENT_NOTE_KEYS.subscriptionId] || null,
          kind: notes[PAYMENT_NOTE_KEYS.kind] || null,
        });
        return { ...result, handled: 'autopay_capture' };
      }
      if (event === RAZORPAY_EVENTS.paymentFailed) {
        const reason =
          paymentEntity?.error_description ||
          paymentEntity?.error_reason ||
          'payment.failed';
        await this.mandates.handleAutopayFailure({
          companyId,
          paymentId: paymentEntity?.id,
          amount: fromMinorUnits(paymentEntity?.amount),
          reason,
          tokenId:
            paymentEntity?.token_id || notes[PAYMENT_NOTE_KEYS.tokenId] || null,
          subscriptionId: notes[PAYMENT_NOTE_KEYS.subscriptionId] || null,
        });
        return { ok: true, handled: 'autopay_failure' };
      }
      // Anything else about an autopay charge is informational.
      return { ok: true, skipped: true };
    }

    // ── First payment: plain link, or mandate registration (auth link) ──
    if (
      event === RAZORPAY_EVENTS.paymentLinkPaid ||
      event === RAZORPAY_EVENTS.paymentCaptured ||
      event === RAZORPAY_EVENTS.orderPaid ||
      event === RAZORPAY_EVENTS.invoicePaid
    ) {
      const tokenId =
        paymentEntity?.token_id ||
        tokenEntity?.id ||
        notes[PAYMENT_NOTE_KEYS.tokenId] ||
        null;

      const result = await this.checkout.finalizeFromWebhook({
        companyId,
        sessionId: notes[PAYMENT_NOTE_KEYS.sessionId],
        orderId: orderEntity?.id || paymentEntity?.order_id,
        paymentLinkId: linkEntity?.id,
        authLinkId: invoiceEntity?.id || notes[PAYMENT_NOTE_KEYS.authLinkId],
        paymentId:
          paymentEntity?.id ||
          (invoiceEntity?.id ? `inv_${invoiceEntity.id}` : undefined) ||
          `plink_${linkEntity?.id}`,
        tokenId,
        customerId:
          paymentEntity?.customer_id ||
          invoiceEntity?.customer_id ||
          tokenEntity?.customer_id ||
          null,
      });
      return { ...result, handled: 'checkout_finalized' };
    }

    // ── Mandate lifecycle ──
    if (event === RAZORPAY_EVENTS.tokenConfirmed) {
      // The token may arrive before/after the payment — finalize either way.
      if (notes[PAYMENT_NOTE_KEYS.sessionId] || tokenEntity?.id) {
        await this.checkout.finalizeFromWebhook({
          companyId,
          sessionId: notes[PAYMENT_NOTE_KEYS.sessionId],
          authLinkId: notes[PAYMENT_NOTE_KEYS.authLinkId],
          paymentId:
            notes[PAYMENT_NOTE_KEYS.paymentId] || `token_${tokenEntity?.id}`,
          tokenId: tokenEntity?.id,
          customerId: tokenEntity?.customer_id,
        });
      }
      if (tokenEntity?.id) {
        await this.mandates.updateStatusFromToken({
          companyId,
          tokenId: tokenEntity.id,
          status: MandateStatus.ACTIVE,
          reason: null,
        });
      }
      return { ok: true, handled: 'token_confirmed' };
    }

    if (
      event === RAZORPAY_EVENTS.tokenPaused ||
      event === RAZORPAY_EVENTS.tokenCancelled ||
      event === RAZORPAY_EVENTS.tokenRejected
    ) {
      const status =
        event === RAZORPAY_EVENTS.tokenPaused
          ? MandateStatus.PAUSED
          : event === RAZORPAY_EVENTS.tokenCancelled
            ? MandateStatus.CANCELLED
            : MandateStatus.REJECTED;

      if (tokenEntity?.id) {
        await this.mandates.updateStatusFromToken({
          companyId,
          tokenId: tokenEntity.id,
          status,
          reason: event,
        });
      }
      // A rejected mandate also fails the checkout that was waiting for it.
      if (
        event === RAZORPAY_EVENTS.tokenRejected &&
        notes[PAYMENT_NOTE_KEYS.sessionId]
      ) {
        await this.checkout.markFailed(
          companyId,
          notes[PAYMENT_NOTE_KEYS.sessionId],
          event,
        );
      }
      return { ok: true, handled: status };
    }

    // ── First-payment failures ──
    if (
      event === RAZORPAY_EVENTS.paymentFailed ||
      event === RAZORPAY_EVENTS.paymentLinkExpired ||
      event === RAZORPAY_EVENTS.invoiceExpired
    ) {
      if (notes[PAYMENT_NOTE_KEYS.sessionId]) {
        await this.checkout.markFailed(
          companyId,
          notes[PAYMENT_NOTE_KEYS.sessionId],
          paymentEntity?.error_description || event,
        );
      }
      return { ok: true, handled: 'checkout_failed' };
    }

    if (event === RAZORPAY_EVENTS.authorizationRevoked) {
      this.logger.warn(`Razorpay authorization revoked for ${companyId}`);
      await this.provider.markRevoked(companyId);
      return { ok: true, handled: 'revoked' };
    }

    return { ok: true, skipped: true };
  }

  /**
   * Dev-only stand-in for the member's UPI app: opening this finalizes the
   * checkout exactly like a real webhook would. Hard-disabled in production.
   */
  @Get('mock-pay/:paymentLinkId')
  async mockPay(
    @Param('paymentLinkId') paymentLinkId: string,
    @Query('token') withToken: string,
    @Res() res: any,
  ) {
    if (!this.runtime.mockAllowed()) {
      throw new ForbiddenException('Mock payments are disabled');
    }

    const session = await this.sessionModel
      .findOne({
        $or: [
          { razorpayPaymentLinkId: paymentLinkId },
          { razorpayAuthLinkId: paymentLinkId },
        ],
      })
      .exec();
    if (!session) {
      throw new NotFoundException('Unknown mock payment link');
    }

    const companyId = String(session.companyId);
    const isAuthLink = session.razorpayAuthLinkId === paymentLinkId;
    const wantsToken = isAuthLink || session.enableAutopay || withToken === '1';

    await this.checkout.finalizeFromWebhook({
      companyId,
      sessionId: session.sessionId,
      paymentLinkId: session.razorpayPaymentLinkId || undefined,
      authLinkId: session.razorpayAuthLinkId || undefined,
      orderId: session.razorpayOrderId || undefined,
      paymentId: `pay_mock_${paymentLinkId}`,
      tokenId: wantsToken
        ? `token_mock_${session.sessionId.slice(0, 8)}`
        : null,
      customerId: session.razorpayCustomerId,
    });

    const query = new URLSearchParams({
      [CRM_QUERY.checkoutSession]: session.sessionId,
      [CRM_QUERY.paid]: '1',
    });
    return res.redirect(
      this.runtime.crmUrl(`${CRM_ROUTES.members}?${query.toString()}`),
    );
  }
}
