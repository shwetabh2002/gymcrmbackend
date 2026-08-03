import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type LocationDocument = Location & Document;

export enum LocationStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Schema({ timestamps: true })
export class Location {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, lowercase: true })
  code: string;

  @Prop({ type: String, default: null })
  address: string | null;

  @Prop({ type: String, default: null })
  city: string | null;

  @Prop({ type: String, default: null })
  phone: string | null;

  /**
   * Per-branch invoice PDF layout. null = inherit company GymSettings.
   * classic | modern | minimal
   */
  @Prop({ type: String, default: null })
  invoiceLayout: string | null;

  @Prop({ type: Boolean, default: null })
  invoiceShowLogo: boolean | null;

  @Prop({ type: Boolean, default: null })
  invoiceShowStamp: boolean | null;

  @Prop({ type: Boolean, default: null })
  invoiceShowGstin: boolean | null;

  @Prop({ type: Boolean, default: null })
  invoiceShowAddress: boolean | null;

  @Prop({ type: Boolean, default: null })
  invoiceShowContact: boolean | null;

  @Prop({
    type: String,
    enum: LocationStatus,
    default: LocationStatus.ACTIVE,
  })
  status: LocationStatus;

  @Prop({ type: Boolean, default: false })
  isDefault: boolean;
}

export const LocationSchema = SchemaFactory.createForClass(Location);
LocationSchema.index({ companyId: 1, code: 1 }, { unique: true });
LocationSchema.index({ companyId: 1, status: 1 });
