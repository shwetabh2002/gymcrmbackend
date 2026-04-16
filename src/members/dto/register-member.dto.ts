import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
  IsEnum,
  IsEmail,
  Min,
} from 'class-validator';
import { MemberStatus } from '../../common/enums/member-status.enum';

export class RegisterMemberDto {
  // Member basic details
  @IsString()
  @IsOptional()
  idNo?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  contactNumber: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsDateString()
  @IsOptional()
  dob?: string;

  @IsDateString()
  @IsOptional()
  anniversaryDate?: string;

  @IsString()
  @IsOptional()
  instagramHandle?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  emergencyContact?: string;

  // Membership details
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  membershipMonths: number; // Number of months (was membershipPlan)

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  amount: number; // Total membership amount

  @IsDateString()
  @IsNotEmpty()
  startingDate: string;

  @IsDateString()
  @IsNotEmpty()
  expiryDate: string;

  // Payment details
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  received: number; // Amount received

  @IsNumber()
  @IsOptional()
  @Min(0)
  pending?: number; // Pending amount (auto-calculated if not provided)

  @IsString()
  @IsNotEmpty()
  mop: string; // Mode of payment

  @IsDateString()
  @IsNotEmpty()
  date: string; // Payment date

  @IsString()
  @IsOptional()
  transactionId?: string;

  // Training details
  @IsString()
  @IsOptional()
  salesPerson?: string;

  @IsString()
  @IsOptional()
  trainer?: string;

  @IsString()
  @IsOptional()
  trainingType?: string;

  @IsString()
  @IsOptional()
  memberType?: string; // New, Renewal, etc.

  @IsEnum(MemberStatus)
  @IsOptional()
  memberStatus?: MemberStatus;

  // Discount details — `discountAmount` (₹) preferred; `discount` (%) legacy
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
