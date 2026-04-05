import { IsOptional, IsString, IsDateString } from 'class-validator';

export class QueryAttendanceDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string; // Format: YYYY-MM-DD

  @IsOptional()
  @IsDateString()
  endDate?: string; // Format: YYYY-MM-DD

  @IsOptional()
  @IsString()
  status?: string; // Present, Absent, Late, etc.

  @IsOptional()
  @IsString()
  month?: string; // Format: YYYY-MM (e.g., "2026-04")
}
