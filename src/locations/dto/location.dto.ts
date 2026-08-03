import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { LocationStatus } from '../schemas/location.schema';
import { INVOICE_LAYOUTS } from '../../config/invoice.config';

const LAYOUTS = [...INVOICE_LAYOUTS] as string[];

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,24}$/, {
    message: 'code must be 2-24 letters/numbers/_/-',
  })
  code?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /** omit = use company default invoice design */
  @IsOptional()
  @IsIn(LAYOUTS)
  invoiceLayout?: string;

  @IsOptional()
  @IsBoolean()
  invoiceShowLogo?: boolean;

  @IsOptional()
  @IsBoolean()
  invoiceShowStamp?: boolean;

  @IsOptional()
  @IsBoolean()
  invoiceShowGstin?: boolean;

  @IsOptional()
  @IsBoolean()
  invoiceShowAddress?: boolean;

  @IsOptional()
  @IsBoolean()
  invoiceShowContact?: boolean;
}

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(LocationStatus)
  status?: LocationStatus;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /** null clears override → inherit company design */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(LAYOUTS)
  invoiceLayout?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  invoiceShowLogo?: boolean | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  invoiceShowStamp?: boolean | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  invoiceShowGstin?: boolean | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  invoiceShowAddress?: boolean | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  invoiceShowContact?: boolean | null;
}
