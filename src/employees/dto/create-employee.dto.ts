import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { EmployeeType } from '../../common/enums/employee-type.enum';
import { AccountStatus } from '../../common/enums/account-status.enum';
import { Permission } from '../../common/enums/permission.enum';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  /** Label only — Staff | Trainer | Sales. Access is customPermissions. */
  @IsEnum(EmployeeType)
  type: EmployeeType;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(AccountStatus)
  @IsOptional()
  status?: AccountStatus;

  @IsString()
  @IsOptional()
  notes?: string;

  /** Home / assigned branch (optional) */
  @IsString()
  @IsOptional()
  locationId?: string;

  /** Explicit CRM access keys — admin chooses freely */
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  customPermissions?: Permission[];
}
