import { IsString, IsNumber, IsEnum, IsEmail, IsDateString, IsBoolean, IsOptional, Min, Max } from 'class-validator';
import { EmployeeType } from '../../common/enums/employee-type.enum';
import { EmployeeStatus } from '../../common/enums/employee-status.enum';

export class CreateEmployeeDto {
  // employeeId is auto-generated, not in DTO

  @IsString()
  name: string;

  @IsNumber()
  @Min(18)
  @Max(100)
  age: number;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsEnum(['Male', 'Female', 'Other'])
  gender?: string;

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

  // Personal Details
  @IsOptional()
  @IsBoolean()
  isMarried?: boolean;

  @IsOptional()
  @IsDateString()
  anniversaryDate?: string;

  @IsOptional()
  @IsString()
  address?: string;

  // Document Details
  @IsOptional()
  @IsEnum(['PAN', 'Aadhar'])
  documentType?: string;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  // Academic Details
  @IsOptional()
  @IsEnum(['10th', '12th', 'Graduation', 'Post Graduation'])
  academicQualification?: string;

  // Trainer Certificate (only for TRAINER type)
  @IsOptional()
  @IsString()
  trainerCertificateNumber?: string;
}
