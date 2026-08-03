import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  MemberSubscription,
  MemberSubscriptionSchema,
} from '../member-subscriptions/schemas/member-subscription.schema';
import {
  SubscriptionPlan,
  SubscriptionPlanSchema,
} from '../subscription-plans/schemas/subscription-plan.schema';
import { CountersModule } from '../counters/counters.module';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { LocationsModule } from '../locations/locations.module';
import { StorageModule } from '../storage/storage.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: MemberSubscription.name, schema: MemberSubscriptionSchema },
      { name: SubscriptionPlan.name, schema: SubscriptionPlanSchema },
    ]),
    CountersModule,
    GymSettingsModule,
    ActivityLogsModule,
    LocationsModule,
    StorageModule,
    forwardRef(() => PaymentsModule),
  ],
  providers: [MembersService],
  controllers: [MembersController],
  exports: [MembersService],
})
export class MembersModule {}
