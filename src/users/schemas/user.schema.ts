import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { UserType } from '../../common/enums/user-type.enum';
import { MemberStatus } from '../../common/enums/member-status.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  email: string;

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

  // Member-specific fields (only populated if userType = MEMBER)
  @Prop({ type: String, default: null })
  phone: string | null;

  @Prop({ type: String, default: null })
  address: string | null;

  @Prop({ type: String, default: null })
  emergencyContact: string | null;

  @Prop({ type: String, enum: MemberStatus, default: MemberStatus.ACTIVE })
  memberStatus: MemberStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'MemberSubscription', default: null })
  currentSubscriptionId: MongooseSchema.Types.ObjectId | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
