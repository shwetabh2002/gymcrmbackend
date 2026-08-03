import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { PaymentMode } from '../../common/enums/payment-mode.enum';

export type PaymentDocument = Payment & Document;

@Schema({ timestamps: true })
export class Payment {
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

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'MemberSubscription',
    required: true,
  })
  subscriptionId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  memberId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  amount: number;

  @Prop({
    type: String,
    enum: PaymentMode,
    required: true,
  })
  paymentMode: PaymentMode;

  @Prop({ required: true, type: Date })
  paymentDate: Date;

  @Prop({ default: null })
  transactionId: string;

  @Prop({ default: null })
  notes: string;

  /** Optional payment screenshot / UPI receipt (S3 URL) */
  @Prop({ type: String, default: null })
  proofUrl: string | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  receivedBy: MongooseSchema.Types.ObjectId; // Admin/Manager who recorded the payment

  /** Razorpay payment id / provider reference */
  @Prop({ type: String, default: null, index: true })
  providerRef: string | null;

  /** FRONT_DESK | AUTOPAY | CHECKOUT */
  @Prop({ type: String, default: 'FRONT_DESK' })
  source: string;

  // Soft-delete marker (P0-12): financial records are voided, never hard-deleted.
  @Prop({ type: Date, default: null })
  deletedAt: Date | null;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
