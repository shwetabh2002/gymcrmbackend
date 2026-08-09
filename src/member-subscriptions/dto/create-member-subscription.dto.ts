import {
  IsIn,
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
import { ACTIVE_PAYMENT_MODES } from '../../config/payment-modes.config';

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

  /** Cash or Online — the manual-fill collection modes. */
  @IsIn(ACTIVE_PAYMENT_MODES)
  @IsOptional()
  paymentMode?: PaymentMode;

  /** If true, cancel any existing ACTIVE subscription before creating */
  @IsBoolean()
  @IsOptional()
  replaceActive?: boolean;
}
