import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { EmployeeType } from '../../common/enums/employee-type.enum';
import { EmployeeStatus } from '../../common/enums/employee-status.enum';

export type EmployeeDocument = Employee & Document;

@Schema({ timestamps: true })
export class Employee {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  age: number;

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
}

export const EmployeeSchema = SchemaFactory.createForClass(Employee);
