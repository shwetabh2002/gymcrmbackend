import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type GymSettingsDocument = GymSettings & Document;

@Schema({ timestamps: true })
export class GymSettings {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    required: true,
    unique: true,
  })
  companyId: Types.ObjectId;

  @Prop({ required: true, default: 'GYM', trim: true })
  memberIdPrefix: string;

  /** Display name across app + invoices */
  @Prop({ type: String, default: null })
  gymName: string | null;

  /** Public S3 URL under companies/{companyId}/… */
  @Prop({ type: String, default: null })
  logoUrl: string | null;

  @Prop({ type: String, default: null })
  faviconUrl: string | null;

  /** Company stamp / seal for invoices */
  @Prop({ type: String, default: null })
  stampUrl: string | null;

  /** Hex brand color e.g. #E23D2B */
  @Prop({ type: String, default: '#E23D2B' })
  primaryColor: string;

  @Prop({ type: String, default: null })
  invoiceAddress: string | null;

  @Prop({ type: String, default: null })
  invoiceEmail: string | null;

  @Prop({ type: String, default: null })
  invoicePhone: string | null;

  @Prop({ type: String, default: null })
  invoiceGstin: string | null;

  @Prop({ type: String, default: null })
  invoiceFooter: string | null;

  @Prop({ type: String, default: null })
  websiteUrl: string | null;

  /** classic | modern | minimal — see config/invoice.config.ts */
  @Prop({ type: String, default: 'classic' })
  invoiceLayout: string;

  /** Even if logo/stamp uploaded, company can hide them on PDFs */
  @Prop({ type: Boolean, default: true })
  invoiceShowLogo: boolean;

  @Prop({ type: Boolean, default: true })
  invoiceShowStamp: boolean;

  @Prop({ type: Boolean, default: true })
  invoiceShowGstin: boolean;

  @Prop({ type: Boolean, default: true })
  invoiceShowAddress: boolean;

  @Prop({ type: Boolean, default: true })
  invoiceShowContact: boolean;

  /** Stamp position on invoice: left | center | right */
  @Prop({ type: String, default: 'right' })
  invoiceStampAlign: string;

  /** GST / tax rate % applied on invoices (0 = no tax line) */
  @Prop({ type: Number, default: 0 })
  invoiceTaxPercentage: number;

  /** excluded = add GST on plan price; included = plan price already has GST */
  @Prop({ type: String, default: 'excluded' })
  invoiceTaxMode: string;

  /**
   * Per-gym feature flag: UPI Autopay / recurring mandate.
   * When false, gym still uses cash/UPI/online one-time — no mandates or autopay charges.
   */
  @Prop({ type: Boolean, default: false })
  autopayEnabled: boolean;
}

export const GymSettingsSchema = SchemaFactory.createForClass(GymSettings);
