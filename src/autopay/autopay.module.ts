import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AutopayWorkerService } from './autopay-worker.service';
import { AutopayController } from './autopay.controller';
import {
  MemberSubscription,
  MemberSubscriptionSchema,
} from '../member-subscriptions/schemas/member-subscription.schema';
import {
  PaymentMandate,
  PaymentMandateSchema,
} from '../checkout/schemas/payment-mandate.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import { PaymentsModule } from '../payments/payments.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MemberSubscription.name, schema: MemberSubscriptionSchema },
      { name: PaymentMandate.name, schema: PaymentMandateSchema },
      { name: User.name, schema: UserSchema },
    ]),
    PaymentProviderModule,
    forwardRef(() => PaymentsModule),
    WhatsAppModule,
    GymSettingsModule,
  ],
  providers: [AutopayWorkerService],
  controllers: [AutopayController],
  exports: [AutopayWorkerService],
})
export class AutopayModule {}
