import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

/**
 * DTO for receiving attendance data pushed from ESSL K30 Pro device
 *
 * The device typically sends data in this format (may vary):
 * {
 *   "SN": "device_serial_number",
 *   "UserID": "1",
 *   "DateTime": "2026-04-06 09:30:00",
 *   "State": "0" (0=Check-in, 1=Check-out, etc.)
 * }
 */
export class DevicePushDto {
  @IsOptional()
  @IsString()
  SN?: string; // Serial Number of device

  @IsOptional()
  @IsString()
  UserID?: string; // User ID in device (employee fingerprint ID)

  @IsOptional()
  @IsString()
  DateTime?: string; // Punch time from device

  @IsOptional()
  @IsNumber()
  State?: number; // State code from device

  // Alternative field names (devices may use different formats)
  @IsOptional()
  @IsString()
  deviceSerialNumber?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  punchTime?: string;

  @IsOptional()
  @IsNumber()
  punchType?: number;

  @IsOptional()
  @IsString()
  deviceIp?: string;
}
