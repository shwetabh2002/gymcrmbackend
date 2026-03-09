import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { MemberStatus } from '../../common/enums/member-status.enum';

export class UpdateMemberDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

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
}
