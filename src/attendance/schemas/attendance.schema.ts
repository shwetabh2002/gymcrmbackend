import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AttendanceDocument = Attendance & Document;

@Schema({
  timestamps: true, // Adds createdAt and updatedAt
  collection: 'attendances',
})
export class Attendance {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  employeeId: Types.ObjectId;

  @Prop({ required: true })
  employeeName: string; // Store name for quick access

  @Prop({ required: true })
  deviceUserId: string; // User ID in fingerprint device (e.g., "1", "2", "3")

  @Prop({ required: true })
  date: string; // Format: YYYY-MM-DD (e.g., "2026-04-06")

  @Prop({ type: Date })
  checkInTime?: Date; // First punch of the day

  @Prop({ type: Date })
  checkOutTime?: Date; // Last punch of the day

  @Prop({ type: [Date], default: [] })
  allPunches: Date[]; // All punch times for the day

  @Prop({
    type: String,
    enum: ['Present', 'Absent', 'Late', 'Half Day', 'Leave'],
    default: 'Absent',
  })
  status: string;

  @Prop({ type: Number, default: 0 })
  workingHours: number; // Total hours worked (checkOut - checkIn)

  @Prop({ type: Boolean, default: false })
  isLate: boolean; // True if checkIn > shift start time

  @Prop({ type: String })
  remarks?: string; // Optional notes

  @Prop({ type: String })
  deviceIp?: string; // IP address of device that sent data

  @Prop({ type: String })
  deviceSerialNumber?: string; // Serial number of fingerprint device
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);

// Indexes for faster queries
AttendanceSchema.index({ employeeId: 1, date: -1 });
AttendanceSchema.index({ date: -1 });
AttendanceSchema.index({ deviceUserId: 1 });
