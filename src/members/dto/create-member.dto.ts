import {
  IsBoolean,
  IsIn,
  IsDateString,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { TrainingType } from '../../common/enums/training-type.enum';
import { PaymentMode } from '../../common/enums/payment-mode.enum';
import { ACTIVE_PAYMENT_MODES } from '../../config/payment-modes.config';

export class CreateMemberDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  /** Frontend uses contactNumber; also accept phone */
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  emergencyContact?: string;

  @IsEnum(MemberStatus)
  @IsOptional()
  memberStatus?: MemberStatus;

  @IsDateString()
  @IsOptional()
  registrationDate?: string;

  @IsDateString()
  @IsOptional()
  dob?: string;

  @IsString()
  @IsOptional()
  instagramHandle?: string;

  @IsEnum(TrainingType)
  @IsOptional()
  trainingType?: TrainingType;

  @IsMongoId()
  @IsOptional()
  trainerId?: string;

  @IsMongoId()
  @IsOptional()
  salesPersonId?: string;

  /** Optional: create subscription in the same request */
  @IsMongoId()
  @IsOptional()
  planId?: string;

  @IsDateString()
  @IsOptional()
  startingDate?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  amount?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  received?: number;

  /** Cash or Online — the manual-fill collection modes. */
  @IsIn(ACTIVE_PAYMENT_MODES)
  @IsOptional()
  paymentMode?: PaymentMode;

  /** Branch for this member (required for create if session has no active location) */
  @IsMongoId()
  @IsOptional()
  locationId?: string;

  /** Optional photo URL (usually set via POST /members/:id/photo) */
  @IsString()
  @IsOptional()
  photoUrl?: string;

  /** Send the welcome email. Default true; needs the member's email address. */
  @IsBoolean()
  @IsOptional()
  sendEmail?: boolean;

  /** Send a welcome message on WhatsApp. Default true. */
  @IsBoolean()
  @IsOptional()
  sendWhatsApp?: boolean;
}
