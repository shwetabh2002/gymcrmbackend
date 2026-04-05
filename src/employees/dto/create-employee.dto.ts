import { IsString, IsNumber, IsEnum, IsEmail, IsDateString, IsBoolean, IsOptional, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { EmployeeType } from '../../common/enums/employee-type.enum';
import { EmployeeStatus } from '../../common/enums/employee-status.enum';

// Helper to convert empty strings to undefined
const EmptyStringToUndefined = () =>
  Transform(({ value }) => (value === '' ? undefined : value));

export class CreateEmployeeDto {
  // employeeId is auto-generated, not in DTO

  @IsString()
  name: string;

  @IsNumber()
  @Min(18)
  @Max(100)
  age: number;

  @IsOptional()
  @EmptyStringToUndefined()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @EmptyStringToUndefined()
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
  @EmptyStringToUndefined()
  @IsDateString()
  anniversaryDate?: string;

  @IsOptional()
  @EmptyStringToUndefined()
  @IsString()
  address?: string;

  // Document Details
  @IsOptional()
  @EmptyStringToUndefined()
  @IsEnum(['PAN', 'Aadhar'])
  documentType?: string;

  @IsOptional()
  @EmptyStringToUndefined()
  @IsString()
  documentNumber?: string;

  // Academic Details
  @IsOptional()
  @EmptyStringToUndefined()
  @IsEnum(['10th', '12th', 'Graduation', 'Post Graduation'])
  academicQualification?: string;

  // Trainer Certificate (only for TRAINER type)
  @IsOptional()
  @EmptyStringToUndefined()
  @IsString()
  trainerCertificateNumber?: string;

  // Biometric Device Integration
  @IsOptional()
  @EmptyStringToUndefined()
  @IsString()
  deviceUserId?: string; // User ID in fingerprint device (e.g., "1", "2", "3")
}
