import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsDateString,
  IsOptional,
  Min,
} from 'class-validator';

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  amount: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  received: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  pending?: number;

  @IsDateString()
  @IsOptional()
  pendingDueDate?: string;

  @IsString()
  @IsNotEmpty()
  mop: string; // Mode of payment: cash, upi, card, bank_transfer

  @IsDateString()
  @IsNotEmpty()
  paymentDate: string;

  @IsString()
  @IsOptional()
  transactionId?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  // Renewal fields (optional) - if provided, updates member's membership details
  @IsNumber()
  @IsOptional()
  @Min(1)
  renewalMonths?: number; // Number of months to extend membership

  @IsDateString()
  @IsOptional()
  newExpiryDate?: string; // New expiry date after renewal

  @IsDateString()
  @IsOptional()
  renewalStartDate?: string;

  @IsString()
  @IsOptional()
  packageName?: string;

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
}
