import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PlatformPlanInquiryDocument = PlatformPlanInquiry & Document;

export const INQUIRY_STATUSES = ['NEW', 'CONTACTED', 'CLOSED'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/**
 * Gym asked about Custom / sales-led pricing. Shown on the SUPER_ADMIN platform
 * screen so the team can reach out.
 */
@Schema({ timestamps: true })
export class PlatformPlanInquiry {
  @Prop({ type: Types.ObjectId, ref: 'Company', required: true, index: true })
  companyId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  companyName: string;

  @Prop({ type: String, required: true, trim: true })
  contactName: string;

  @Prop({ type: String, required: true, trim: true })
  contactPhone: string;

  @Prop({ type: String, default: null, trim: true })
  contactEmail: string | null;

  /** How many branches / locations they operate. */
  @Prop({ type: Number, required: true, min: 1 })
  branchCount: number;

  /** Approx active members (free-text ok via number). */
  @Prop({ type: Number, default: null, min: 0 })
  approxMembers: number | null;

  /** What they care about most — free-form, multi-select joined. */
  @Prop({ type: [String], default: [] })
  needs: string[];

  /** Current software, if any. */
  @Prop({ type: String, default: null, trim: true })
  currentSoftware: string | null;

  @Prop({ type: String, default: null, trim: true, maxlength: 2000 })
  message: string | null;

  @Prop({ type: String, enum: INQUIRY_STATUSES, default: 'NEW', index: true })
  status: InquiryStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  submittedByUserId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  contactedAt: Date | null;

  @Prop({ type: String, default: null, trim: true })
  adminNotes: string | null;
}

export const PlatformPlanInquirySchema =
  SchemaFactory.createForClass(PlatformPlanInquiry);

PlatformPlanInquirySchema.index({ status: 1, createdAt: -1 });
