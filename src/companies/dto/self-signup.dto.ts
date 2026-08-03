import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  Matches,
} from 'class-validator';
import { COUNTRIES } from '../../config/countries.config';

const COUNTRY_CODES = COUNTRIES.map((c) => c.code);

export class SelfSignupDto {
  @IsString()
  @IsNotEmpty()
  gymName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  city?: string;

  /** ISO country — defaults to IN if omitted */
  @IsOptional()
  @IsString()
  @IsIn(COUNTRY_CODES)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,12}$/, {
    message: 'memberIdPrefix must be 2-12 letters/numbers',
  })
  memberIdPrefix?: string;

  @IsString()
  @IsNotEmpty()
  adminName: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @MinLength(6)
  adminPassword: string;
}
