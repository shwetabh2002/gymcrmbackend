import { IsString } from 'class-validator';

export class UnlockEmployeeSectionDto {
  @IsString()
  password: string;
}
