import { IsEmail, IsEnum, IsOptional, IsString, IsNumber, IsDateString, Min } from 'class-validator';
import { MemberStatus } from '../../common/enums/member-status.enum';

export class UpdateMemberDto {
  // Basic Info
  @IsString()
  @IsOptional()
  idNo?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  contactNumber?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  emergencyContact?: string;

  @IsDateString()
  @IsOptional()
  dob?: string;

  @IsDateString()
  @IsOptional()
  anniversaryDate?: string;

  @IsString()
  @IsOptional()
  instagramHandle?: string;

  // Membership Info
  @IsString()
  @IsOptional()
  membershipPlan?: string;

  @IsNumber()
  @IsOptional()
  membershipMonths?: number;

  @IsNumber()
  @IsOptional()
  membershipAmount?: number;

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsNumber()
  @IsOptional()
  received?: number;

  @IsNumber()
  @IsOptional()
  pending?: number;

  @IsString()
  @IsOptional()
  mop?: string;

  @IsDateString()
  @IsOptional()
  startingDate?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  // Training Info
  @IsString()
  @IsOptional()
  trainingType?: string;

  @IsString()
  @IsOptional()
  trainer?: string;

  @IsString()
  @IsOptional()
  salesPerson?: string;

  @IsString()
  @IsOptional()
  memberType?: string;

  @IsEnum(MemberStatus)
  @IsOptional()
  memberStatus?: MemberStatus;

  // Discount Info — `discountAmount` (₹) preferred; `discount` (%) legacy
  @IsNumber()
  @IsOptional()
  @Min(0)
  discountAmount?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  discount?: number;

  @IsString()
  @IsOptional()
  discountApprovedBy?: string;
}
