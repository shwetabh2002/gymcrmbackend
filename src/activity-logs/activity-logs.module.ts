import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivityLogsService } from './activity-logs.service';
import { ActivityLogsController } from './activity-logs.controller';
import { ActivityLogInterceptor } from './activity-log.interceptor';
import {
  ActivityLog,
  ActivityLogSchema,
} from './schemas/activity-log.schema';
import {
  GymSettings,
  GymSettingsSchema,
} from '../gym-settings/schemas/gym-settings.schema';
import {
  PlatformSubscription,
  PlatformSubscriptionSchema,
} from '../platform-billing/schemas/platform-subscription.schema';
import {
  PlatformPlan,
  PlatformPlanSchema,
} from '../platform-billing/schemas/platform-plan.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ActivityLog.name, schema: ActivityLogSchema },
      { name: GymSettings.name, schema: GymSettingsSchema },
      { name: PlatformSubscription.name, schema: PlatformSubscriptionSchema },
      { name: PlatformPlan.name, schema: PlatformPlanSchema },
    ]),
  ],
  controllers: [ActivityLogsController],
  providers: [ActivityLogsService, ActivityLogInterceptor],
  exports: [ActivityLogsService, ActivityLogInterceptor, MongooseModule],
})
export class ActivityLogsModule {}
