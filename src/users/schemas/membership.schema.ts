import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

@Schema({ _id: true, timestamps: true })
export class Membership {
  _id: MongooseSchema.Types.ObjectId;

  @Prop({ type: Date, required: true })
  startDate: Date;

  @Prop({ type: Date, required: true })
  expiryDate: Date;

  @Prop({ type: Number, required: true })
  months: number;

  @Prop({ type: Number, required: true })
  totalAmount: number;

  @Prop({ type: Number, required: true, default: 0 })
  amountPaid: number;

  @Prop({ type: Number, required: true, default: 0 })
  pendingAmount: number;

  @Prop({ type: Date, default: null })
  pendingDueDate: Date | null;

  @Prop({
    type: String,
    enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
    default: 'ACTIVE',
  })
  status: string;

  @Prop({ type: String, default: null })
  package: string;

  @Prop({ type: String, default: null })
  trainingType: string;

  @Prop({ type: String, default: null })
  trainer: string;

  @Prop({ type: String, default: null })
  salesPerson: string;

  @Prop({ type: String, default: null })
  memberType: string; // New, Old, Renewal
}

export const MembershipSchema = SchemaFactory.createForClass(Membership);
