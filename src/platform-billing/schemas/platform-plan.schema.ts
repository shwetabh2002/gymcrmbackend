import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  BILLING_INTERVALS,
  BillingInterval,
  PLATFORM_FEATURES,
  PlatformFeature,
} from '../../config/platform-billing.config';

export type PlatformPlanDocument = PlatformPlan & Document;

/**
 * What a gym pays *us* — distinct from SubscriptionPlan, which is what a gym's
 * own members pay.
 *
 * A row rather than config so pricing, limits and feature bundles can change
 * without a deploy, and so a gym stays on the plan it signed up to even after
 * the public price moves.
 */
@Schema({ timestamps: true })
export class PlatformPlan {
  /** Stable identifier used in code and URLs, e.g. STARTER. */
  @Prop({ type: String, required: true, unique: true, uppercase: true, trim: true })
  code: string;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, default: null })
  description: string | null;

  /**
   * Charged per branch, per interval. Billing multiplies this by the gym's
   * active branch count — a per-member price would punish the gyms that grow.
   */
  @Prop({ type: Number, required: true, min: 0 })
  pricePerBranch: number;

  @Prop({ type: String, enum: BILLING_INTERVALS, default: 'MONTHLY' })
  interval: BillingInterval;

  /** ISO 4217. Defaults to the platform's country currency. */
  @Prop({ type: String, default: 'INR', uppercase: true })
  currency: string;

  /** Free days granted when a gym starts on this plan. */
  @Prop({ type: Number, default: 10, min: 0 })
  trialDays: number;

  /** Capabilities unlocked; anything absent is blocked for gyms on this plan. */
  @Prop({ type: [String], enum: PLATFORM_FEATURES, default: [] })
  features: PlatformFeature[];

  /** null = unlimited. */
  @Prop({ type: Number, default: null })
  maxBranches: number | null;

  @Prop({ type: Number, default: null })
  maxMembers: number | null;

  /** Hidden from the public plan list but still honoured for gyms already on it. */
  @Prop({ type: Boolean, default: true })
  isPublic: boolean;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  /** Order in the pricing table. */
  @Prop({ type: Number, default: 0 })
  sortOrder: number;

  /** Marks the plan highlighted in the UI. */
  @Prop({ type: Boolean, default: false })
  isRecommended: boolean;

  /**
   * Sales-led plan: gym cannot self-subscribe. They submit an inquiry and we
   * reach out with a tailored quote.
   */
  @Prop({ type: Boolean, default: false })
  isContactSales: boolean;
}

export const PlatformPlanSchema = SchemaFactory.createForClass(PlatformPlan);

/** The public pricing table reads in this order. */
PlatformPlanSchema.index({ isActive: 1, isPublic: 1, sortOrder: 1 });
