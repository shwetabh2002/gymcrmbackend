import {
  IsBoolean,
  IsDateString,
  IsEmail,
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

  /**
   * Send the payment / mandate link to the member on WhatsApp.
   * Defaults to true — pass false when the member is paying at the desk.
   */
  @IsOptional()
  @IsBoolean()
  sendWhatsApp?: boolean;

  /** Email the same link. Defaults to true, needs a member email to do anything. */
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;

  /** Optional member email — required for the email option to work. */
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
