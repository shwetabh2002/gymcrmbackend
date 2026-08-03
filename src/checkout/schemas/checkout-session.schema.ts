import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { CheckoutSessionStatus } from '../../common/enums/checkout-session-status.enum';

export type CheckoutSessionDocument = CheckoutSession & Document;

@Schema({ timestamps: true })
export class CheckoutSession {
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
  })
  locationId: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, index: true })
  sessionId: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  draftMemberId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'SubscriptionPlan',
    required: true,
  })
  planId: Types.ObjectId;

  /** Plan price snapshot */
  @Prop({ required: true })
  amount: number;

  /** First charge amount (may be partial) */
  @Prop({ required: true })
  receivedIntent: number;

  @Prop({ type: Date, required: true })
  startDate: Date;

  @Prop({ type: Date, required: true })
  expiryDate: Date;

  @Prop({
    type: String,
    enum: CheckoutSessionStatus,
    default: CheckoutSessionStatus.PENDING,
    index: true,
  })
  status: CheckoutSessionStatus;

  /** Register UPI Autopay mandate on this checkout */
  @Prop({ type: Boolean, default: true })
  enableAutopay: boolean;

  @Prop({ type: String, default: null })
  razorpayCustomerId: string | null;

  @Prop({ type: String, default: null, index: true })
  razorpayOrderId: string | null;

  @Prop({ type: String, default: null })
  razorpayPaymentId: string | null;

  @Prop({ type: String, default: null })
  razorpayTokenId: string | null;

  @Prop({ type: String, default: null })
  razorpayPaymentLinkId: string | null;

  @Prop({ type: String, default: null })
  shareUrl: string | null;

  /** Raw QR payload / UPI intent string */
  @Prop({ type: String, default: null })
  qrData: string | null;

  @Prop({ type: String, default: null })
  whatsappUrl: string | null;

  /** How the payment message was delivered: mock | cloud_api | wa_me */
  @Prop({ type: String, default: null })
  whatsappMode: 'wa_me' | 'cloud_api' | 'mock' | null;

  @Prop({ type: Boolean, default: false })
  whatsappSent: boolean;

  /** E.164-ish digits the auto-send targeted (91XXXXXXXXXX) */
  @Prop({ type: String, default: null })
  whatsappToPhone: string | null;

  @Prop({ type: String, default: null })
  idempotencyKey: string | null;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
  })
  createdByUserId: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'MemberSubscription',
    default: null,
  })
  subscriptionId: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Payment',
    default: null,
  })
  paymentId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  failureReason: string | null;
}

export const CheckoutSessionSchema =
  SchemaFactory.createForClass(CheckoutSession);
CheckoutSessionSchema.index({ companyId: 1, razorpayOrderId: 1 });
