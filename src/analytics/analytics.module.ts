import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  MemberSubscription,
  MemberSubscriptionSchema,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import {
  SubscriptionPlan,
  SubscriptionPlanSchema,
} from '../subscription-plans/schemas/subscription-plan.schema';
import {
  MemberPayment,
  MemberPaymentSchema,
} from '../members/schemas/member-payment.schema';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: MemberSubscription.name, schema: MemberSubscriptionSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: SubscriptionPlan.name, schema: SubscriptionPlanSchema },
      { name: MemberPayment.name, schema: MemberPaymentSchema },
    ]),
  ],
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
