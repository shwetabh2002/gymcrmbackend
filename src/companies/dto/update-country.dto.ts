import { IsIn, IsString } from 'class-validator';
import { COUNTRIES } from '../../config/countries.config';

const CODES = COUNTRIES.map((c) => c.code);

export class UpdateCountryDto {
  @IsString()
  @IsIn(CODES)
  countryCode!: string;
}
