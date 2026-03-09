import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type InvoiceDocument = Invoice & Document;

@Schema({ timestamps: true })
export class Invoice {
  @Prop({ required: true, unique: true })
  invoiceNumber: string; // Format: GYM-YYYY-NNN

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  memberId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'MemberSubscription',
    required: true,
  })
  subscriptionId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Payment', required: true })
  paymentId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, type: Date })
  date: Date;

  @Prop({ type: String, default: null })
  pdfUrl: string | null; // Path or URL to generated PDF
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
