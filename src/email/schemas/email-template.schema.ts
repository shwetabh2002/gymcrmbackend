import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import {
  EMAIL_TYPE_LIST,
  EmailType,
} from '../../config/email-templates.config';

export type EmailTemplateDocument = EmailTemplate & Document;

/**
 * A gym's override for one transactional email.
 *
 * Absent row = platform default from config/email-templates.config.ts, so a gym
 * that never opens Settings still gets sensible mails.
 */
@Schema({ timestamps: true })
export class EmailTemplate {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({ type: String, enum: EMAIL_TYPE_LIST, required: true, index: true })
  type: EmailType;

  /** null = use the platform default for this field. */
  @Prop({ type: String, default: null })
  subject: string | null;

  @Prop({ type: String, default: null })
  body: string | null;

  /** Off = this email is never sent for this gym, whatever the caller asks. */
  @Prop({ type: Boolean, default: true })
  enabled: boolean;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
  })
  updatedByUserId: Types.ObjectId | null;
}

export const EmailTemplateSchema = SchemaFactory.createForClass(EmailTemplate);

/** One row per gym per type. */
EmailTemplateSchema.index({ companyId: 1, type: 1 }, { unique: true });
