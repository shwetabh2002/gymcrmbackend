import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { EmployeeType } from '../../common/enums/employee-type.enum';
import { EmployeeStatus } from '../../common/enums/employee-status.enum';

export type EmployeeDocument = Employee & Document;

@Schema({ timestamps: true })
export class Employee {
  @Prop({ required: true, unique: true })
  employeeId: string; // Auto-generated (EMP-001, EMP-002, etc.)

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  age: number;

  @Prop({ type: Date })
  dob: Date; // Date of Birth

  @Prop({ type: String, enum: ['Male', 'Female', 'Other'] })
  gender: string;

  @Prop({ required: true })
  salary: number;

  @Prop({ type: String, enum: EmployeeType, required: true })
  employeeType: EmployeeType;

  @Prop({ type: String, enum: EmployeeStatus, default: EmployeeStatus.ACTIVE })
  status: EmployeeStatus;

  @Prop({ type: Date, required: true })
  joiningDate: Date;

  @Prop({ required: true })
  phone: string;

  @Prop({ required: true })
  email: string;

  // Personal Details
  @Prop({ type: Boolean, default: false })
  isMarried: boolean;

  @Prop({ type: Date })
  anniversaryDate: Date; // Only if married

  @Prop()
  address: string;

  // Document Details
  @Prop({ type: String, enum: ['PAN', 'Aadhar'] })
  documentType: string;

  @Prop()
  documentNumber: string;

  // Academic Details
  @Prop({ type: String, enum: ['10th', '12th', 'Graduation', 'Post Graduation'] })
  academicQualification: string;

  // Trainer Certificate (only for TRAINER type)
  @Prop()
  trainerCertificateNumber: string;

  // Biometric Device Integration
  @Prop()
  deviceUserId: string; // User ID in fingerprint device (e.g., "1", "2", "3")
}

export const EmployeeSchema = SchemaFactory.createForClass(Employee);
