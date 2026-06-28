import { IsOptional, IsString, Matches } from 'class-validator';

/** YYYY-MM-DD inclusive date bounds for list/export filters */
export class DateRangeQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateFrom must be YYYY-MM-DD',
  })
  dateFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateTo must be YYYY-MM-DD',
  })
  dateTo?: string;
}
