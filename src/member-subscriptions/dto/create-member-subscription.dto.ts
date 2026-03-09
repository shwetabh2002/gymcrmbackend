import {
  IsMongoId,
  IsNotEmpty,
  IsDateString,
  IsOptional,
  IsNumber,
  Min,
} from 'class-validator';

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
  initialPayment?: number; // Optional initial payment amount
}
