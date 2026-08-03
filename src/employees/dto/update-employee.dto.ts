import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { EmployeeType } from '../../common/enums/employee-type.enum';
import { AccountStatus } from '../../common/enums/account-status.enum';
import { Permission } from '../../common/enums/permission.enum';

export class UpdateEmployeeDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MinLength(6)
  password?: string;

  @IsEnum(EmployeeType)
  @IsOptional()
  type?: EmployeeType;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(AccountStatus)
  @IsOptional()
  status?: AccountStatus;

  @IsString()
  @IsOptional()
  notes?: string;

  /** Home / assigned branch (optional). Pass null/empty to clear. */
  @IsString()
  @IsOptional()
  locationId?: string | null;

  /** Explicit allow-list. Use with useRoleDefaults=false. */
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  customPermissions?: Permission[];

  /** If true, clear overrides and fall back to role defaults. */
  @IsOptional()
  @IsBoolean()
  useRoleDefaults?: boolean;
}
