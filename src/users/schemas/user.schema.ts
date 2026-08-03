import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { UserType } from '../../common/enums/user-type.enum';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { TrainingType } from '../../common/enums/training-type.enum';
import { AccountStatus } from '../../common/enums/account-status.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  /**
   * Required for staff/admin login. Members may omit email (null).
   * Uniqueness is enforced via partial index below — not on this Prop —
   * so multiple members can have null email.
   */
  @Prop({ type: String, default: null })
  email: string | null;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: String, enum: Role, default: Role.USER })
  role: Role;

  @Prop({ type: String, enum: UserType, required: true })
  userType: UserType;

  @Prop({ type: String, default: null })
  refreshToken: string | null;

  /** Login-capable staff/admin account status */
  @Prop({
    type: String,
    enum: AccountStatus,
    default: AccountStatus.ACTIVE,
  })
  accountStatus: AccountStatus;

  @Prop({ type: String, default: null })
  notes: string | null;

  // Member-specific fields (only populated if userType = MEMBER)
  @Prop({ type: String, default: null })
  phone: string | null;

  @Prop({ type: String, default: null })
  address: string | null;

  @Prop({ type: String, default: null })
  emergencyContact: string | null;

  @Prop({ type: String, enum: MemberStatus, default: MemberStatus.ACTIVE })
  memberStatus: MemberStatus;

  /** Online checkout / autopay onboarding */
  @Prop({ type: String, default: 'ACTIVE' })
  onboardingStatus: string;

  @Prop({ type: String, default: null })
  rzpCustomerId: string | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'MemberSubscription',
    default: null,
  })
  currentSubscriptionId: MongooseSchema.Types.ObjectId | null;

  /** Human-readable member ID e.g. GYM-0001 (unique per company) */
  @Prop({ type: String, default: null })
  idNo: string | null;

  @Prop({ type: Date, default: null })
  registrationDate: Date | null;

  @Prop({ type: Date, default: null })
  dob: Date | null;

  @Prop({ type: String, default: null })
  instagramHandle: string | null;

  /** Optional member / employee profile photo (S3 URL) */
  @Prop({ type: String, default: null })
  photoUrl: string | null;

  @Prop({ type: String, enum: TrainingType, default: null })
  trainingType: TrainingType | null;

  /** Assigned trainer — User with role TRAINER */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
  })
  trainerId: MongooseSchema.Types.ObjectId | null;

  /** Assigned sales person — User with role SALES */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
  })
  salesPersonId: MongooseSchema.Types.ObjectId | null;

  /**
   * Per-employee permission overrides.
   * null = use role defaults; string[] = explicit allow-list.
   */
  @Prop({ type: [String], default: null })
  customPermissions: string[] | null;

  /** Tenant gym — null only for platform SUPER_ADMIN */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true,
  })
  companyId: Types.ObjectId | null;

  /** SUPER_ADMIN currently viewing this company */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    default: null,
  })
  activeCompanyId: MongooseSchema.Types.ObjectId | null;

  /** Home / assigned branch (members should always have one) */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Location',
    default: null,
    index: true,
  })
  locationId: Types.ObjectId | null;

  /** Session filter — null = all locations in company */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Location',
    default: null,
  })
  activeLocationId: Types.ObjectId | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ companyId: 1, userType: 1 });
UserSchema.index({ companyId: 1, locationId: 1, userType: 1 });
UserSchema.index({ companyId: 1, idNo: 1 }, { unique: true, sparse: true });
/** Unique only when email is a real string (staff + members who provided one). */
UserSchema.index(
  { email: 1 },
  {
    unique: true,
    name: 'email_unique_partial',
    partialFilterExpression: { email: { $type: 'string' } },
  },
);
/** One member per phone within a company. */
UserSchema.index(
  { companyId: 1, phone: 1 },
  {
    unique: true,
    name: 'company_member_phone_unique',
    partialFilterExpression: {
      userType: UserType.MEMBER,
      phone: { $type: 'string' },
    },
  },
);
