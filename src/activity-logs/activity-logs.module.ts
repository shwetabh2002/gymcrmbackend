import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivityLogsService } from './activity-logs.service';
import {
  ActivityLog,
  ActivityLogSchema,
} from './schemas/activity-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ActivityLog.name, schema: ActivityLogSchema },
    ]),
  ],
  providers: [ActivityLogsService],
  exports: [ActivityLogsService, MongooseModule],
})
export class ActivityLogsModule {}
