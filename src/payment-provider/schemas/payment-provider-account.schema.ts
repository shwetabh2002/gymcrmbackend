import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import {
  PaymentProvider,
  PaymentProviderAccountStatus,
  PaymentProviderAuthMode,
} from '../../common/enums/payment-provider.enum';

export type PaymentProviderAccountDocument = PaymentProviderAccount & Document;

@Schema({ timestamps: true })
export class PaymentProviderAccount {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    required: true,
    unique: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({ type: String, enum: PaymentProvider, default: PaymentProvider.RAZORPAY })
  provider: PaymentProvider;

  @Prop({
    type: String,
    enum: PaymentProviderAccountStatus,
    default: PaymentProviderAccountStatus.NOT_CONNECTED,
  })
  status: PaymentProviderAccountStatus;

  @Prop({
    type: String,
    enum: PaymentProviderAuthMode,
    default: PaymentProviderAuthMode.OAUTH,
  })
  authMode: PaymentProviderAuthMode;

  /** Razorpay merchant / account id */
  @Prop({ type: String, default: null })
  razorpayAccountId: string | null;

  @Prop({ type: String, default: null })
  accountName: string | null;

  /** Encrypted OAuth access token or key_secret */
  @Prop({ type: String, default: null })
  accessTokenEnc: string | null;

  @Prop({ type: String, default: null })
  refreshTokenEnc: string | null;

  /** Encrypted key_id for API_KEYS mode (or public key_id plaintext — still encrypt) */
  @Prop({ type: String, default: null })
  keyIdEnc: string | null;

  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  @Prop({ type: [String], default: [] })
  scopes: string[];

  @Prop({ type: String, default: null })
  webhookSecretEnc: string | null;

  @Prop({ type: Date, default: null })
  connectedAt: Date | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
  })
  connectedByUserId: Types.ObjectId | null;
}

export const PaymentProviderAccountSchema =
  SchemaFactory.createForClass(PaymentProviderAccount);
