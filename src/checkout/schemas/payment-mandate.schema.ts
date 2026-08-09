import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { PaymentProvider } from '../../common/enums/payment-provider.enum';
import { MandateStatus } from '../../common/enums/billing.enum';

export type PaymentMandateDocument = PaymentMandate & Document;

@Schema({ timestamps: true })
export class PaymentMandate {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  memberId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'MemberSubscription',
    default: null,
  })
  subscriptionId: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: PaymentProvider,
    default: PaymentProvider.RAZORPAY,
  })
  provider: PaymentProvider;

  @Prop({ type: String, required: true, index: true })
  tokenId: string;

  /** Razorpay customer the token hangs off — required to charge it. */
  @Prop({ type: String, default: null })
  customerId: string | null;

  /** upi | emandate | card | nach */
  @Prop({ type: String, default: 'upi' })
  method: string;

  /** Ceiling per debit agreed by the member (₹, not paise). */
  @Prop({ type: Number, default: null })
  maxAmount: number | null;

  /** Mandate validity — after this Razorpay refuses further debits. */
  @Prop({ type: Date, default: null })
  expireAt: Date | null;

  /** Registration link (inv_…) this mandate was created from. */
  @Prop({ type: String, default: null })
  authLinkId: string | null;

  @Prop({ type: String, default: 'as_presented' })
  frequency: string;

  @Prop({
    type: String,
    enum: MandateStatus,
    default: MandateStatus.CREATED,
    index: true,
  })
  status: MandateStatus;

  @Prop({ type: Date, default: null })
  lastChargedAt: Date | null;

  @Prop({ type: Date, default: null, index: true })
  nextChargeAt: Date | null;

  @Prop({ type: String, default: null })
  lastFailureReason: string | null;

  /**
   * Charge Razorpay accepted but has not confirmed yet. The payment.captured /
   * payment.failed webhook clears this; until then the worker will not retry.
   */
  @Prop({ type: String, default: null, index: true })
  pendingPaymentId: string | null;

  @Prop({ type: Number, default: null })
  pendingAmount: number | null;

  @Prop({ type: Date, default: null })
  pendingSince: Date | null;

  @Prop({ type: Number, default: 0 })
  consecutiveFailures: number;
}

export const PaymentMandateSchema =
  SchemaFactory.createForClass(PaymentMandate);
PaymentMandateSchema.index({ companyId: 1, memberId: 1 });
