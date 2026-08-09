import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateInvoiceItemDto {
  @IsString()
  description: string;

  /**
   * Only honoured on standalone invoices. On an invoice generated from a
   * payment the money is fixed by that payment — see InvoicesService.update.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;
}

/**
 * What may be corrected after an invoice exists.
 *
 * Deliberately narrower than "everything": the invoice number, the member, the
 * subscription and the linked payment are what make the document traceable, so
 * they are not editable. A wrong amount means the *payment* was wrong — void it
 * and record the right one, which reverses the invoice too.
 */
export class UpdateInvoiceDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateInvoiceItemDto)
  items?: UpdateInvoiceItemDto[];

  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Standalone invoices only. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxPercentage?: number;
}
