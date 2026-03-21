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
}
