import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type PlatformChargeDocument = PlatformCharge & Document;

export const PLATFORM_CHARGE_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
] as const;
export type PlatformChargeStatus = (typeof PLATFORM_CHARGE_STATUSES)[number];

/**
 * One attempt to collect our fee from a gym — the platform's own ledger.
 *
 * Append-only, like the gym-side payments ledger: a failed attempt stays as a
 * failed row so dunning and revenue can both be explained after the fact.
 */
@Schema({ timestamps: true })
export class PlatformCharge {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'PlatformSubscription',
    required: true,
  })
  subscriptionId: Types.ObjectId;

  /** Invoice number shown to the gym, e.g. PLT-20260810-0001. */
  @Prop({ type: String, required: true, unique: true })
  invoiceNumber: string;

  @Prop({ type: String, required: true })
  planCode: string;

  @Prop({ type: Number, required: true })
  branches: number;

  /** Before tax. */
  @Prop({ type: Number, required: true })
  subtotal: number;

  @Prop({ type: Number, default: 0 })
  taxPercentage: number;

  @Prop({ type: Number, default: 0 })
  taxAmount: number;

  @Prop({ type: Number, required: true })
  totalAmount: number;

  @Prop({ type: String, default: 'INR' })
  currency: string;

  @Prop({
    type: String,
    enum: PLATFORM_CHARGE_STATUSES,
    default: 'PENDING',
    index: true,
  })
  status: PlatformChargeStatus;

  /** Period this charge covers. */
  @Prop({ type: Date, required: true })
  periodStart: Date;

  @Prop({ type: Date, required: true })
  periodEnd: Date;

  /** Razorpay payment id — also the idempotency key for a retried webhook. */
  @Prop({ type: String, default: null, index: true })
  providerRef: string | null;

  @Prop({ type: String, default: null })
  failureReason: string | null;

  @Prop({ type: Date, default: null })
  paidAt: Date | null;
}

export const PlatformChargeSchema =
  SchemaFactory.createForClass(PlatformCharge);

/** A gym's billing history, newest first. */
PlatformChargeSchema.index({ companyId: 1, createdAt: -1 });

/** Platform revenue reporting. */
PlatformChargeSchema.index({ status: 1, paidAt: -1 });
