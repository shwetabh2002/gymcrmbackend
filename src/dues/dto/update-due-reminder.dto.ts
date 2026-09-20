import { IsDateString, IsOptional, ValidateIf } from 'class-validator';

export class UpdateDueReminderDto {
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsDateString()
  @IsOptional()
  dueReminderDate?: string | null;
}
