import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { MemberStatus } from '../../common/enums/member-status.enum';
import { TrainingType } from '../../common/enums/training-type.enum';

export class UpdateMemberDto {
  @IsString()
  @IsOptional()
  name?: string;

  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsEmail()
  @IsOptional()
  email?: string | null;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  emergencyContact?: string;

  @IsEnum(MemberStatus)
  @IsOptional()
  memberStatus?: MemberStatus;

  @IsDateString()
  @IsOptional()
  registrationDate?: string;

  @IsDateString()
  @IsOptional()
  dob?: string;

  @IsString()
  @IsOptional()
  instagramHandle?: string;

  @IsEnum(TrainingType)
  @IsOptional()
  trainingType?: TrainingType;

  @IsMongoId()
  @IsOptional()
  trainerId?: string;

  @IsMongoId()
  @IsOptional()
  salesPersonId?: string;

  @IsString()
  @IsOptional()
  photoUrl?: string;
}
