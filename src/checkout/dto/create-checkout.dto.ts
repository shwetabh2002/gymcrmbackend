import {
  IsBoolean,
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateCheckoutDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsMongoId()
  planId: string;

  @IsMongoId()
  locationId: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsNumber()
  @Min(1)
  received: number;

  @IsDateString()
  startingDate: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsDateString()
  registrationDate?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  trainingType?: string;

  @IsOptional()
  @IsMongoId()
  trainerId?: string;

  @IsOptional()
  @IsMongoId()
  salesPersonId?: string;

  @IsOptional()
  @IsBoolean()
  enableAutopay?: boolean;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
