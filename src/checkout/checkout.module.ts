import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CheckoutSession,
  CheckoutSessionSchema,
} from './schemas/checkout-session.schema';
import {
  PaymentMandate,
  PaymentMandateSchema,
} from './schemas/payment-mandate.schema';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  SubscriptionPlan,
  SubscriptionPlanSchema,
} from '../subscription-plans/schemas/subscription-plan.schema';
import {
  MemberSubscription,
  MemberSubscriptionSchema,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { CountersModule } from '../counters/counters.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';
import { LocationsModule } from '../locations/locations.module';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CheckoutSession.name, schema: CheckoutSessionSchema },
      { name: PaymentMandate.name, schema: PaymentMandateSchema },
      { name: User.name, schema: UserSchema },
      { name: SubscriptionPlan.name, schema: SubscriptionPlanSchema },
      { name: MemberSubscription.name, schema: MemberSubscriptionSchema },
    ]),
    CountersModule,
    GymSettingsModule,
    LocationsModule,
    PaymentProviderModule,
    WhatsAppModule,
    forwardRef(() => PaymentsModule),
  ],
  providers: [CheckoutService],
  controllers: [CheckoutController],
  exports: [CheckoutService, MongooseModule],
})
export class CheckoutModule {}
