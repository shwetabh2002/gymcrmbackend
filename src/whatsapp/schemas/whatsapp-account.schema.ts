import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type WhatsAppAccountDocument = WhatsAppAccount & Document;

export enum WhatsAppAuthMode {
  CLOUD_API = 'CLOUD_API',
  MOCK = 'MOCK',
}

export enum WhatsAppAccountStatus {
  NOT_CONNECTED = 'NOT_CONNECTED',
  CONNECTED = 'CONNECTED',
  REVOKED = 'REVOKED',
}

@Schema({ timestamps: true })
export class WhatsAppAccount {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    required: true,
    unique: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({
    type: String,
    enum: WhatsAppAccountStatus,
    default: WhatsAppAccountStatus.NOT_CONNECTED,
  })
  status: WhatsAppAccountStatus;

  @Prop({
    type: String,
    enum: WhatsAppAuthMode,
    default: WhatsAppAuthMode.MOCK,
  })
  authMode: WhatsAppAuthMode;

  /** Encrypted Cloud API token */
  @Prop({ type: String, default: null })
  cloudTokenEnc: string | null;

  @Prop({ type: String, default: null })
  phoneNumberId: string | null;

  /** Approved Meta template name for payment links */
  @Prop({ type: String, default: null })
  paymentTemplate: string | null;

  @Prop({ type: String, default: 'en' })
  templateLanguage: string;

  @Prop({ type: String, default: null })
  displayName: string | null;

  @Prop({ type: Date, default: null })
  connectedAt: Date | null;
}

export const WhatsAppAccountSchema =
  SchemaFactory.createForClass(WhatsAppAccount);
