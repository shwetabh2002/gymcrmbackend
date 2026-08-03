import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { PaymentMode } from '../../common/enums/payment-mode.enum';

export class CreateMemberSubscriptionDto {
  @IsMongoId()
  @IsNotEmpty()
  memberId: string;

  @IsMongoId()
  @IsNotEmpty()
  planId: string;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  initialPayment?: number;

  /** Optional override; if omitted, computed from plan duration */
  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @IsEnum(PaymentMode)
  @IsOptional()
  paymentMode?: PaymentMode;

  /** If true, cancel any existing ACTIVE subscription before creating */
  @IsBoolean()
  @IsOptional()
  replaceActive?: boolean;
}
