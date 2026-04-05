import {
  IsString,
  IsDateString,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';

export class ManualAttendanceDto {
  @IsString()
  employeeId: string;

  @IsDateString()
  date: string; // Format: YYYY-MM-DD

  @IsOptional()
  @IsDateString()
  checkInTime?: string; // ISO 8601 format

  @IsOptional()
  @IsDateString()
  checkOutTime?: string; // ISO 8601 format

  @IsEnum(['Present', 'Absent', 'Late', 'Half Day', 'Leave'])
  status: string;

  @IsOptional()
  @IsBoolean()
  isLate?: boolean;

  @IsOptional()
  @IsString()
  remarks?: string;
}
