import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RenewalsService } from './renewals.service';
import { RenewalsController } from './renewals.controller';
import {
  MemberSubscription,
  MemberSubscriptionSchema,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MemberSubscription.name, schema: MemberSubscriptionSchema },
    ]),
    ActivityLogsModule,
  ],
  controllers: [RenewalsController],
  providers: [RenewalsService],
  exports: [RenewalsService],
})
export class RenewalsModule {}
