import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { SubscriptionStatus } from '../../common/enums/subscription-status.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';

export type MemberSubscriptionDocument = MemberSubscription & Document;

@Schema({ timestamps: true })
export class MemberSubscription {
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
}

export const MemberSubscriptionSchema =
  SchemaFactory.createForClass(MemberSubscription);
