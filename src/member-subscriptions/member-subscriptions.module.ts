import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MemberSubscriptionsService } from './member-subscriptions.service';
import { MemberSubscriptionsController } from './member-subscriptions.controller';
import {
  MemberSubscription,
  MemberSubscriptionSchema,
} from './schemas/member-subscription.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  SubscriptionPlan,
  SubscriptionPlanSchema,
} from '../subscription-plans/schemas/subscription-plan.schema';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { PaymentsModule } from '../payments/payments.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MemberSubscription.name, schema: MemberSubscriptionSchema },
      { name: User.name, schema: UserSchema },
      { name: SubscriptionPlan.name, schema: SubscriptionPlanSchema },
    ]),
    ActivityLogsModule,
    GymSettingsModule,
    forwardRef(() => PaymentsModule),
  ],
  providers: [MemberSubscriptionsService],
  controllers: [MemberSubscriptionsController],
  exports: [MemberSubscriptionsService],
})
export class MemberSubscriptionsModule {}
