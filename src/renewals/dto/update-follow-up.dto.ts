import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { RenewalFollowUpStatus } from '../../common/enums/renewal-follow-up-status.enum';

export class UpdateFollowUpDto {
  @IsOptional()
  @IsEnum(RenewalFollowUpStatus)
  renewalFollowUpStatus?: RenewalFollowUpStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  followUpNotes?: string;

  @IsOptional()
  @IsDateString()
  followUpNextActionAt?: string;
}
