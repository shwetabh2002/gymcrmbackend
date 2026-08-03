import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type CompanyDocument = Company & Document;

export enum CompanyStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  TRIAL = 'TRIAL',
}

export enum CompanySource {
  SELF = 'SELF',
  MANUAL = 'MANUAL',
}

@Schema({ timestamps: true })
export class Company {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ type: String, enum: CompanyStatus, default: CompanyStatus.TRIAL })
  status: CompanyStatus;

  @Prop({ type: String, enum: CompanySource, default: CompanySource.SELF })
  source: CompanySource;

  @Prop({ type: String, default: null })
  phone: string | null;

  @Prop({ type: String, default: null })
  city: string | null;

  /** ISO country code e.g. IN, AE, US — see config/countries.config.ts */
  @Prop({ type: String, default: 'IN', uppercase: true, trim: true, index: true })
  countryCode: string;

  @Prop({ type: String, default: 'GYM', trim: true })
  memberIdPrefix: string;

  /** Gym ADMIN user who owns this company */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
  })
  ownerUserId: MongooseSchema.Types.ObjectId | null;
}

export const CompanySchema = SchemaFactory.createForClass(Company);
CompanySchema.index({ status: 1, createdAt: -1 });
