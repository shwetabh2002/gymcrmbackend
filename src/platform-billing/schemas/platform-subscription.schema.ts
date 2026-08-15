import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import {
  BILLING_INTERVALS,
  BILLING_STATUSES,
  BillingInterval,
  BillingStatus,
} from '../../config/platform-billing.config';

export type PlatformSubscriptionDocument = PlatformSubscription & Document;

/**
 * One gym's standing with the platform: which plan, paid until when, and what
 * happens next.
 *
 * Separate from the Company document because it changes on its own schedule —
 * every renewal, every failed charge, every plan change writes here, and none
 * of that should churn the company record.
 */
@Schema({ timestamps: true })
export class PlatformSubscription {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    required: true,
    unique: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'PlatformPlan',
    required: true,
    index: true,
  })
  planId: Types.ObjectId;

  /** Copied at signup so a public price change never re-prices an existing gym. */
  @Prop({ type: String, required: true })
  planCode: string;

  @Prop({ type: Number, required: true })
  pricePerBranch: number;

  @Prop({ type: String, enum: BILLING_INTERVALS, default: 'MONTHLY' })
  interval: BillingInterval;

  @Prop({ type: String, default: 'INR' })
  currency: string;

  @Prop({
    type: String,
    enum: BILLING_STATUSES,
    default: 'TRIALING',
    index: true,
  })
  status: BillingStatus;

  /** End of the free window. Indexed — the sweep asks "who expires today?". */
  @Prop({ type: Date, default: null, index: true })
  trialEndsAt: Date | null;

  @Prop({ type: Date, default: null })
  currentPeriodStart: Date | null;

  /** When the next charge is due. Also indexed for the sweep. */
  @Prop({ type: Date, default: null, index: true })
  currentPeriodEnd: Date | null;

  /** Branches counted at the last charge — what the amount was based on. */
  @Prop({ type: Number, default: 1 })
  billedBranches: number;

  @Prop({ type: Number, default: 0 })
  lastAmount: number;

  /**
   * The gym's UPI Autopay mandate for *our* fees, taken at signup. The same
   * machinery the gyms use on their own members.
   */
  @Prop({ type: String, default: null })
  mandateTokenId: string | null;

  @Prop({ type: String, default: null })
  mandateCustomerId: string | null;

  @Prop({ type: Date, default: null })
  mandateApprovedAt: Date | null;

  /** Registration link while the mandate is still pending approval. */
  @Prop({ type: String, default: null })
  mandateAuthLinkId: string | null;

  @Prop({ type: String, default: null })
  mandateShareUrl: string | null;

  @Prop({ type: Date, default: null })
  lastChargeAt: Date | null;

  @Prop({ type: String, default: null })
  lastFailureReason: string | null;

  /** Consecutive failures; drives the dunning schedule. */
  @Prop({ type: Number, default: 0 })
  dunningAttempts: number;

  @Prop({ type: Date, default: null })
  nextRetryAt: Date | null;

  /** Set when the gym cancels; access continues until the period ends. */
  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  @Prop({ type: String, default: null })
  cancellationReason: string | null;

  /** Reminders already sent, so a sweep every six hours does not repeat them. */
  @Prop({ type: [Number], default: [] })
  trialRemindersSent: number[];
}

export const PlatformSubscriptionSchema = SchemaFactory.createForClass(
  PlatformSubscription,
);

/** The sweep looks for work by status and date. */
PlatformSubscriptionSchema.index({ status: 1, trialEndsAt: 1 });
PlatformSubscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });
PlatformSubscriptionSchema.index({ status: 1, nextRetryAt: 1 });
