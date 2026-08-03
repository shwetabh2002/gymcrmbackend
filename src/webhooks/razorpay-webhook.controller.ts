import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { CheckoutService } from '../checkout/checkout.service';
import { PaymentProviderService } from '../payment-provider/payment-provider.service';
import { RazorpayApiService } from '../payment-provider/razorpay-api.service';
import {
  CheckoutSession,
  CheckoutSessionDocument,
} from '../checkout/schemas/checkout-session.schema';

@Controller('webhooks/razorpay')
export class RazorpayWebhookController {
  private readonly logger = new Logger(RazorpayWebhookController.name);

  constructor(
    private checkout: CheckoutService,
    private provider: PaymentProviderService,
    private razorpay: RazorpayApiService,
    private config: ConfigService,
    @InjectModel(CheckoutSession.name)
    private sessionModel: Model<CheckoutSessionDocument>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Body() body: any,
    @Headers('x-razorpay-signature') signature: string,
    @Req() req: any,
  ) {
    const raw =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : JSON.stringify(body || {});
    const secret = this.provider.getWebhookSecret();
    const skipVerify =
      this.config.get('RAZORPAY_SKIP_WEBHOOK_VERIFY') === 'true' ||
      this.config.get('NODE_ENV') !== 'production';

    if (!skipVerify && signature) {
      const ok = this.razorpay.verifyWebhookSignature(raw, signature, secret);
      if (!ok) {
        this.logger.warn('Invalid Razorpay webhook signature');
        return { ok: false };
      }
    }

    const event = body?.event as string;
    this.logger.log(`Razorpay webhook: ${event}`);

    const companyId =
      (await this.provider.resolveCompanyFromWebhookPayload(body)) ||
      body?.payload?.payment_link?.entity?.notes?.companyId ||
      body?.payload?.payment?.entity?.notes?.companyId;

    if (!companyId) {
      this.logger.warn('Webhook missing companyId');
      return { ok: true, skipped: true };
    }

    if (
      event === 'payment_link.paid' ||
      event === 'payment.captured' ||
      event === 'order.paid'
    ) {
      const paymentEntity =
        body?.payload?.payment?.entity ||
        body?.payload?.payment_link?.entity?.payments?.[0];
      const linkEntity = body?.payload?.payment_link?.entity;
      const orderEntity = body?.payload?.order?.entity;
      const notes =
        paymentEntity?.notes || linkEntity?.notes || orderEntity?.notes || {};

      const tokenId =
        paymentEntity?.token_id ||
        body?.payload?.token?.entity?.id ||
        notes.tokenId ||
        null;

      await this.checkout.finalizeFromWebhook({
        companyId: String(companyId),
        sessionId: notes.sessionId,
        orderId: orderEntity?.id || paymentEntity?.order_id,
        paymentLinkId: linkEntity?.id,
        paymentId: paymentEntity?.id || `plink_${linkEntity?.id}`,
        tokenId,
        customerId: paymentEntity?.customer_id || null,
      });
    }

    if (event === 'token.confirmed') {
      const token = body?.payload?.token?.entity;
      const notes = token?.notes || {};
      if (notes.sessionId) {
        await this.checkout.finalizeFromWebhook({
          companyId: String(companyId),
          sessionId: notes.sessionId,
          paymentId: notes.paymentId || `token_${token.id}`,
          tokenId: token.id,
          customerId: token.customer_id,
        });
      }
    }

    if (
      event === 'payment.failed' ||
      event === 'payment_link.expired' ||
      event === 'token.rejected'
    ) {
      const notes =
        body?.payload?.payment?.entity?.notes ||
        body?.payload?.payment_link?.entity?.notes ||
        body?.payload?.token?.entity?.notes ||
        {};
      if (notes.sessionId) {
        await this.checkout.markFailed(
          String(companyId),
          notes.sessionId,
          event,
        );
      }
    }

    if (event === 'account.app.authorization_revoked') {
      this.logger.warn(`Razorpay authorization revoked for ${companyId}`);
    }

    return { ok: true };
  }

  @Get('mock-pay/:paymentLinkId')
  async mockPay(
    @Param('paymentLinkId') paymentLinkId: string,
    @Query('token') withToken: string,
    @Res() res: any,
  ) {
    const session = await this.sessionModel
      .findOne({ razorpayPaymentLinkId: paymentLinkId })
      .exec();
    if (!session) {
      return res.status(404).send('Unknown mock payment link');
    }
    const companyId = String(session.companyId);
    await this.checkout.finalizeFromWebhook({
      companyId,
      sessionId: session.sessionId,
      paymentLinkId,
      orderId: session.razorpayOrderId || undefined,
      paymentId: `pay_mock_${paymentLinkId}`,
      tokenId:
        session.enableAutopay || withToken === '1'
          ? `token_mock_${session.sessionId.slice(0, 8)}`
          : null,
      customerId: session.razorpayCustomerId,
    });

    const frontend =
      this.config.get('CRM_PUBLIC_URL') ||
      this.config.get('FRONTEND_URL') ||
      'http://localhost:3000';
    return res.redirect(
      `${frontend}/users?checkout=${session.sessionId}&paid=1`,
    );
  }
}
