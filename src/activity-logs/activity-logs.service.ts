import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ActivityLog,
  ActivityLogDocument,
} from './schemas/activity-log.schema';

export type ActivityActor = {
  userId: string;
  name: string;
};

export type LogActivityInput = {
  companyId: string;
  locationId?: string | null;
  actor: ActivityActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class ActivityLogsService {
  private readonly logger = new Logger(ActivityLogsService.name);

  constructor(
    @InjectModel(ActivityLog.name)
    private activityLogModel: Model<ActivityLogDocument>,
  ) {}

  async log(input: LogActivityInput) {
    try {
      if (!input.actor?.userId || !input.companyId) return null;
      return await this.activityLogModel.create({
        companyId: new Types.ObjectId(input.companyId) as any,
        locationId: input.locationId
          ? (new Types.ObjectId(input.locationId) as any)
          : null,
        actorId: new Types.ObjectId(input.actor.userId) as any,
        actorName: input.actor.name || 'Unknown',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        metadata: input.metadata ?? {},
      });
    } catch (err: any) {
      this.logger.warn(`Failed to write activity log: ${err?.message}`);
      return null;
    }
  }

  async findRecent(
    companyId: string,
    limit = 25,
    locScope: { locationId?: string } = {},
  ) {
    return this.activityLogModel
      .find({ companyId, ...locScope })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }
}
