import { IsOptional, IsDateString } from 'class-validator';

export class SyncEsslDto {
  /** ISO date — start of range (default: 7 days ago) */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** ISO date — end of range (default: now) */
  @IsOptional()
  @IsDateString()
  to?: string;
}
