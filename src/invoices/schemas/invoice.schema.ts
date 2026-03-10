import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type InvoiceDocument = Invoice & Document;

export interface InvoiceItem {
  description: string;
  amount: number;
}

@Schema({ timestamps: true })
export class Invoice {
  @Prop({ required: true, unique: true })
  invoiceNumber: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  memberId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'MemberSubscription',
    required: true,
  })
  subscriptionId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: [
      {
        description: { type: String, required: true },
        amount: { type: Number, required: true },
      },
    ],
    required: true,
  })
  items: InvoiceItem[];

  @Prop({ required: true })
  subtotal: number;

  @Prop({ default: 0 })
  taxPercentage: number;

  @Prop({ default: 0 })
  taxAmount: number;

  @Prop({ required: true })
  totalAmount: number;

  @Prop({ required: true, type: Date })
  invoiceDate: Date;

  @Prop({ type: Date, default: null })
  dueDate: Date;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Payment',
    default: null,
  })
  paymentId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  generatedBy: MongooseSchema.Types.ObjectId;

  @Prop({ default: null })
  notes: string;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
