import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DuesService } from './dues.service';
import { DuesController } from './dues.controller';
import {
  MemberSubscription,
  MemberSubscriptionSchema,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { MemberSubscriptionsModule } from '../member-subscriptions/member-subscriptions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MemberSubscription.name, schema: MemberSubscriptionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    MemberSubscriptionsModule,
  ],
  controllers: [DuesController],
  providers: [DuesService],
  exports: [DuesService],
})
export class DuesModule {}
