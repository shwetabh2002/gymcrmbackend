import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { SubscriptionStatus } from '../../common/enums/subscription-status.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { RenewalFollowUpStatus } from '../../common/enums/renewal-follow-up-status.enum';

export type MemberSubscriptionDocument = MemberSubscription & Document;

@Schema({ timestamps: true })
export class MemberSubscription {
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
    required: true,
    index: true,
  })
  locationId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  memberId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'SubscriptionPlan',
    required: true,
  })
  planId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, type: Date })
  startDate: Date;

  @Prop({ required: true, type: Date })
  expiryDate: Date;

  @Prop({
    type: String,
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
  subscriptionStatus: SubscriptionStatus;

  @Prop({ required: true })
  planPrice: number; // Snapshot of plan price at time of assignment

  @Prop({ default: 0 })
  totalPaid: number; // Sum of all payments

  @Prop({ required: true })
  pendingAmount: number; // planPrice - totalPaid

  @Prop({
    type: String,
    enum: PaymentStatus,
    default: PaymentStatus.UNPAID,
  })
  paymentStatus: PaymentStatus;

  /** CRM work-queue state for renewal follow-up (separate from subscription lifecycle) */
  @Prop({
    type: String,
    enum: RenewalFollowUpStatus,
    default: RenewalFollowUpStatus.PENDING,
  })
  renewalFollowUpStatus: RenewalFollowUpStatus;

  @Prop({ type: Date })
  lastFollowUpAt?: Date;

  @Prop({ type: String })
  followUpNotes?: string;

  @Prop({ type: Date })
  followUpNextActionAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  lastFollowUpById?: MongooseSchema.Types.ObjectId | null;

  @Prop({ type: String, default: null })
  lastFollowUpByName?: string | null;

  /** MANUAL (front-desk) or AUTOPAY (UPI mandate) */
  @Prop({ type: String, default: 'MANUAL' })
  billingMode: string;

  /**
   * totalPaid / pendingAmount describe the CURRENT billing cycle only.
   * An autopay renewal starts a fresh cycle instead of piling onto the old
   * totals, so `pendingAmount` stays a truthful "kitna baaki hai".
   * Lifetime money always comes from the payments ledger, never from here.
   */
  @Prop({ type: Number, default: 0 })
  renewalCount: number;

  @Prop({ type: Date, default: null })
  cycleStartDate: Date | null;

  @Prop({ type: Date, default: null })
  lastRenewedAt: Date | null;

  /** Sum of every payment ever applied, across all cycles. */
  @Prop({ type: Number, default: 0 })
  lifetimePaid: number;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'PaymentMandate',
    default: null,
  })
  mandateId: Types.ObjectId | null;

  /**
   * When the member promised to pay the remaining balance (partial payment).
   * Used to sort the dues queue — nearest reminder first.
   */
  @Prop({ type: Date, default: null })
  dueReminderDate: Date | null;

  /**
   * GST snapshot at subscription create — later gym-setting changes must not
   * rewrite how this membership's amounts / invoices are taxed.
   */
  @Prop({ type: Number, default: null })
  taxPercentage: number | null;

  @Prop({ type: String, default: null })
  taxMode: string | null;
}

export const MemberSubscriptionSchema =
  SchemaFactory.createForClass(MemberSubscription);

/**
 * The autopay sweep filters on billingMode + status + mandateId and then on
 * expiry / pending. Without this the sweep scans the whole collection, which
 * only gets worse as gyms are added.
 */
MemberSubscriptionSchema.index({
  billingMode: 1,
  subscriptionStatus: 1,
  mandateId: 1,
  expiryDate: 1,
});

/** Renewal queue and dashboard both slice by company + expiry window. */
MemberSubscriptionSchema.index({ companyId: 1, expiryDate: 1 });

/** Per-member subscription history. */
MemberSubscriptionSchema.index({ companyId: 1, memberId: 1, createdAt: -1 });

/** Partial-payment dues queue: pending > 0, sort by reminder. */
MemberSubscriptionSchema.index({
  companyId: 1,
  pendingAmount: 1,
  dueReminderDate: 1,
});

/** Branch-scoped renewal / list windows. */
MemberSubscriptionSchema.index({ companyId: 1, locationId: 1, expiryDate: 1 });
