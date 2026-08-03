import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { CheckoutModule } from '../checkout/checkout.module';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import {
  CheckoutSession,
  CheckoutSessionSchema,
} from '../checkout/schemas/checkout-session.schema';

@Module({
  imports: [
    forwardRef(() => CheckoutModule),
    PaymentProviderModule,
    MongooseModule.forFeature([
      { name: CheckoutSession.name, schema: CheckoutSessionSchema },
    ]),
  ],
  controllers: [RazorpayWebhookController],
})
export class WebhooksModule {}
