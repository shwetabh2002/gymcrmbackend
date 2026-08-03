import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type WhatsAppMessageDocument = WhatsAppMessage & Document;

export enum WhatsAppMessageStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class WhatsAppMessage {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  toPhone: string;

  @Prop({ type: String, required: true })
  body: string;

  @Prop({ type: String, default: null })
  payUrl: string | null;

  @Prop({ type: String, default: null })
  checkoutSessionId: string | null;

  @Prop({ type: String, default: 'payment_link' })
  kind: string;

  @Prop({
    type: String,
    enum: WhatsAppMessageStatus,
    default: WhatsAppMessageStatus.QUEUED,
  })
  status: WhatsAppMessageStatus;

  @Prop({ type: String, default: null })
  providerMode: string | null;

  @Prop({ type: String, default: null })
  providerMessageId: string | null;

  @Prop({ type: String, default: null })
  failureReason: string | null;
}

export const WhatsAppMessageSchema =
  SchemaFactory.createForClass(WhatsAppMessage);
WhatsAppMessageSchema.index({ companyId: 1, createdAt: -1 });
