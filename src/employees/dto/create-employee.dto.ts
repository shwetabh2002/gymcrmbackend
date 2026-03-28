import { IsString, IsNumber, IsEnum, IsEmail, IsDateString, Min, Max } from 'class-validator';
import { EmployeeType } from '../../common/enums/employee-type.enum';
import { EmployeeStatus } from '../../common/enums/employee-status.enum';

export class CreateEmployeeDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(18)
  @Max(100)
  age: number;

  @IsNumber()
  salary: number;

  @IsEnum(EmployeeType)
  employeeType: EmployeeType;

  @IsEnum(EmployeeStatus)
  status: EmployeeStatus;

  @IsDateString()
  joiningDate: string;

  @IsString()
  phone: string;

  @IsEmail()
  email: string;
}
