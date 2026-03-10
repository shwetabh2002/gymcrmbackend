import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { PaymentMode } from '../../common/enums/payment-mode.enum';

export type PaymentDocument = Payment & Document;

@Schema({ timestamps: true })
export class Payment {
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

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  receivedBy: MongooseSchema.Types.ObjectId; // Admin/Manager who recorded the payment
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
