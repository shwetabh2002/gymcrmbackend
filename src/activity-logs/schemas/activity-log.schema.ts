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

  /** Null for system / worker actions when no staff user. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  actorId: Types.ObjectId | null;

  @Prop({ required: true })
  actorName: string;

  @Prop({ type: String, default: null })
  actorEmail: string | null;

  @Prop({ type: String, default: null })
  actorRole: string | null;

  @Prop({ required: true, index: true })
  action: string;

  @Prop({ required: true, index: true })
  entityType: string;

  @Prop({ type: String, default: null })
  entityId: string | null;

  @Prop({ required: true })
  summary: string;

  @Prop({ type: String, default: null })
  httpMethod: string | null;

  @Prop({ type: String, default: null })
  httpPath: string | null;

  @Prop({ type: Number, default: null })
  statusCode: number | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;
}

export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);
ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ actorId: 1, createdAt: -1 });
ActivityLogSchema.index({ companyId: 1, createdAt: -1 });
ActivityLogSchema.index({ companyId: 1, action: 1, createdAt: -1 });
