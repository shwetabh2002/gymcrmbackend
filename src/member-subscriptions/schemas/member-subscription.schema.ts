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

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'PaymentMandate',
    default: null,
  })
  mandateId: Types.ObjectId | null;
}

export const MemberSubscriptionSchema =
  SchemaFactory.createForClass(MemberSubscription);
