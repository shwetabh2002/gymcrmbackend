import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { PaymentMode } from '../../common/enums/payment-mode.enum';
import { ACTIVE_PAYMENT_MODES } from '../../config/payment-modes.config';

export class CreatePaymentDto {
  @IsNotEmpty()
  @IsString()
  subscriptionId: string;

  @IsNotEmpty()
  @IsString()
  memberId: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  /**
   * Cash or Online only. Legacy rows may still hold UPI / CARD / BANK_TRANSFER;
   * new payments use the active set — see config/payment-modes.config.ts.
   */
  @IsNotEmpty()
  @IsIn(ACTIVE_PAYMENT_MODES)
  paymentMode: PaymentMode;

  @IsNotEmpty()
  @IsDateString()
  paymentDate: string;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
