import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import {
  MemberSubscription,
  MemberSubscriptionSchema,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Invoice, InvoiceSchema } from '../invoices/schemas/invoice.schema';
import { CountersModule } from '../counters/counters.module';
import { MemberSubscriptionsModule } from '../member-subscriptions/member-subscriptions.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';
import {
  GymSettings,
  GymSettingsSchema,
} from '../gym-settings/schemas/gym-settings.schema';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: MemberSubscription.name, schema: MemberSubscriptionSchema },
      { name: User.name, schema: UserSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: GymSettings.name, schema: GymSettingsSchema },
    ]),
    CountersModule,
    forwardRef(() => MemberSubscriptionsModule),
    ActivityLogsModule,
    GymSettingsModule,
    StorageModule,
  ],
  providers: [PaymentsService],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
