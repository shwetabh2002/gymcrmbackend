import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MemberSubscription.name, schema: MemberSubscriptionSchema },
      { name: User.name, schema: UserSchema },
      { name: SubscriptionPlan.name, schema: SubscriptionPlanSchema },
    ]),
  ],
  providers: [MemberSubscriptionsService],
  controllers: [MemberSubscriptionsController],
  exports: [MemberSubscriptionsService],
})
export class MemberSubscriptionsModule {}
