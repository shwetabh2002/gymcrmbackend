import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { INVOICE_LAYOUTS, INVOICE_STAMP_ALIGNS } from '../../config/invoice.config';
import { COUNTRIES } from '../../config/countries.config';
import { INVOICE_TAX_MODES } from '../../invoices/tax.util';

export class UpdateGymSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  memberIdPrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  gymName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#([0-9A-Fa-f]{6})$/, {
    message: 'primaryColor must be a hex color like #E23D2B',
  })
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  invoiceAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  invoiceEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  invoicePhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  invoiceGstin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  invoiceFooter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  faviconUrl?: string;

  @IsOptional()
  @IsString()
  stampUrl?: string;

  @IsOptional()
  @IsIn([...INVOICE_LAYOUTS])
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

  @IsOptional()
  @IsIn([...INVOICE_STAMP_ALIGNS])
  invoiceStampAlign?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  invoiceTaxPercentage?: number;

  @IsOptional()
  @IsIn([...INVOICE_TAX_MODES])
  invoiceTaxMode?: string;

  /** Per-gym: enable UPI Autopay / recurring. Off = normal platform without autopay. */
  @IsOptional()
  @IsBoolean()
  autopayEnabled?: boolean;

  /** ISO country code for this gym — see config/countries.config.ts */
  @IsOptional()
  @IsString()
  @IsIn([...COUNTRIES.map((c) => c.code)])
  countryCode?: string;
}
