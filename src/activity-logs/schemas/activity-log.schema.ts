import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type ActivityLogDocument = ActivityLog & Document;

@Schema({ timestamps: true })
export class ActivityLog {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Location',
    default: null,
    index: true,
  })
  locationId: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  actorId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  actorName: string;

  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  entityType: string;

  @Prop({ type: String, default: null })
  entityId: string | null;

  @Prop({ required: true })
  summary: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;
}

export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);
ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ actorId: 1, createdAt: -1 });
