import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { Invoice, InvoiceSchema } from './schemas/invoice.schema';
import {
  MemberSubscription,
  MemberSubscriptionSchema,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { CountersModule } from '../counters/counters.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import {
  GymSettings,
  GymSettingsSchema,
} from '../gym-settings/schemas/gym-settings.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: MemberSubscription.name, schema: MemberSubscriptionSchema },
      { name: User.name, schema: UserSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: GymSettings.name, schema: GymSettingsSchema },
    ]),
    CountersModule,
    ActivityLogsModule,
  ],
  providers: [InvoicesService],
  controllers: [InvoicesController],
  exports: [InvoicesService],
})
export class InvoicesModule {}
