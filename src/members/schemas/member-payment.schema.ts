import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type MemberPaymentDocument = MemberPayment & Document;

@Schema({ timestamps: true })
export class MemberPayment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  memberId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  membershipId: MongooseSchema.Types.ObjectId | null; // Links to specific membership in user.memberships array

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ type: Number, required: true })
  received: number;

  @Prop({ type: Number, required: true, default: 0 })
  pending: number;

  @Prop({ type: String, required: true })
  mop: string; // Mode of payment (upi, cash, card, etc.)

  @Prop({ type: Date, required: true })
  paymentDate: Date;

  @Prop({ type: String, default: null })
  transactionId: string | null;

  @Prop({ type: String, default: null })
  notes: string | null;
}

export const MemberPaymentSchema = SchemaFactory.createForClass(MemberPayment);
