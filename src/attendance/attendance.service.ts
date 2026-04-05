import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Attendance, AttendanceDocument } from './schemas/attendance.schema';
import { DevicePushDto } from './dto/device-push.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { ManualAttendanceDto } from './dto/manual-attendance.dto';
import { EmployeesService } from '../employees/employees.service';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @InjectModel(Attendance.name)
    private attendanceModel: Model<AttendanceDocument>,
    private employeesService: EmployeesService,
  ) {}

  /**
   * Process attendance data pushed from ESSL K30 Pro device
   */
  async processPushData(data: DevicePushDto, deviceIp?: string) {
    try {
      this.logger.log(`📥 Received push data from device: ${JSON.stringify(data)}`);

      // Extract data (handle different field name formats)
      const deviceUserId = data.UserID || data.userId;
      const punchTime = data.DateTime || data.punchTime;
      const deviceSN = data.SN || data.deviceSerialNumber;

      if (!deviceUserId || !punchTime) {
        this.logger.warn('⚠️  Invalid push data - missing userId or punchTime');
        return { success: false, message: 'Missing required fields' };
      }

      // Find employee by deviceUserId
      const employee = await this.employeesService.findByDeviceUserId(
        deviceUserId,
      );

      if (!employee) {
        this.logger.warn(
          `⚠️  No employee found for device user ID: ${deviceUserId}`,
        );
        return {
          success: false,
          message: `Employee not found for device user ID: ${deviceUserId}`,
        };
      }

      // Parse punch time
      const punchDateTime = new Date(punchTime);
      const date = punchDateTime.toISOString().split('T')[0]; // YYYY-MM-DD

      // Find or create attendance record for this employee on this date
      let attendance = await this.attendanceModel.findOne({
        employeeId: employee._id,
        date,
      });

      if (!attendance) {
        // Create new attendance record
        attendance = new this.attendanceModel({
          employeeId: employee._id,
          employeeName: employee.name,
          deviceUserId,
          date,
          checkInTime: punchDateTime,
          allPunches: [punchDateTime],
          status: 'Present',
          deviceIp,
          deviceSerialNumber: deviceSN,
        });
      } else {
        // Update existing record
        attendance.allPunches.push(punchDateTime);

        // Update check-in (earliest punch)
        if (!attendance.checkInTime || punchDateTime < attendance.checkInTime) {
          attendance.checkInTime = punchDateTime;
        }

        // Update check-out (latest punch)
        if (!attendance.checkOutTime || punchDateTime > attendance.checkOutTime) {
          attendance.checkOutTime = punchDateTime;
        }
      }

      // Calculate working hours if both check-in and check-out exist
      if (attendance.checkInTime && attendance.checkOutTime) {
        const diffMs =
          attendance.checkOutTime.getTime() - attendance.checkInTime.getTime();
        attendance.workingHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
      }

      // Check if late (assume shift starts at 9:00 AM)
      const shiftStartHour = 9;
      const checkInHour = punchDateTime.getHours();
      const checkInMinute = punchDateTime.getMinutes();

      if (
        checkInHour > shiftStartHour ||
        (checkInHour === shiftStartHour && checkInMinute > 15)
      ) {
        attendance.isLate = true;
        attendance.status = 'Late';
      }

      await attendance.save();

      this.logger.log(
        `✅ Attendance recorded for ${employee.name} on ${date} at ${punchDateTime.toLocaleTimeString()}`,
      );

      return {
        success: true,
        message: 'Attendance recorded successfully',
        data: attendance,
      };
    } catch (error) {
      this.logger.error('❌ Error processing push data:', error);
      throw error;
    }
  }

  /**
   * Get attendance records with filters
   */
  async findAll(query: QueryAttendanceDto) {
    const filter: any = {};

    if (query.employeeId) {
      filter.employeeId = query.employeeId;
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.startDate && query.endDate) {
      filter.date = { $gte: query.startDate, $lte: query.endDate };
    } else if (query.month) {
      // Month format: YYYY-MM
      const startDate = `${query.month}-01`;
      const year = parseInt(query.month.split('-')[0]);
      const month = parseInt(query.month.split('-')[1]);
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${query.month}-${lastDay}`;
      filter.date = { $gte: startDate, $lte: endDate };
    }

    return this.attendanceModel
      .find(filter)
      .populate('employeeId', 'name phone email employeeType')
      .sort({ date: -1 })
      .exec();
  }

  /**
   * Get attendance for specific employee
   */
  async findByEmployee(employeeId: string, month?: string) {
    const filter: any = { employeeId };

    if (month) {
      const startDate = `${month}-01`;
      const year = parseInt(month.split('-')[0]);
      const monthNum = parseInt(month.split('-')[1]);
      const lastDay = new Date(year, monthNum, 0).getDate();
      const endDate = `${month}-${lastDay}`;
      filter.date = { $gte: startDate, $lte: endDate };
    }

    return this.attendanceModel.find(filter).sort({ date: -1 }).exec();
  }

  /**
   * Get today's attendance
   */
  async getTodayAttendance() {
    const today = new Date().toISOString().split('T')[0];
    return this.attendanceModel
      .find({ date: today })
      .populate('employeeId', 'name phone employeeType')
      .sort({ checkInTime: 1 })
      .exec();
  }

  /**
   * Manually create/update attendance (for admins)
   */
  async createManual(dto: ManualAttendanceDto) {
    const employee = await this.employeesService.findById(dto.employeeId);

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    // Check if attendance already exists
    const existing = await this.attendanceModel.findOne({
      employeeId: dto.employeeId,
      date: dto.date,
    });

    if (existing) {
      // Update existing
      existing.checkInTime = dto.checkInTime ? new Date(dto.checkInTime) : existing.checkInTime;
      existing.checkOutTime = dto.checkOutTime ? new Date(dto.checkOutTime) : existing.checkOutTime;
      existing.status = dto.status;
      existing.isLate = dto.isLate || false;
      existing.remarks = dto.remarks;

      if (existing.checkInTime && existing.checkOutTime) {
        const diffMs =
          existing.checkOutTime.getTime() - existing.checkInTime.getTime();
        existing.workingHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
      }

      return existing.save();
    }

    // Create new
    const attendance = new this.attendanceModel({
      employeeId: dto.employeeId,
      employeeName: employee.name,
      deviceUserId: employee.deviceUserId || 'manual',
      date: dto.date,
      checkInTime: dto.checkInTime ? new Date(dto.checkInTime) : undefined,
      checkOutTime: dto.checkOutTime ? new Date(dto.checkOutTime) : undefined,
      status: dto.status,
      isLate: dto.isLate || false,
      remarks: dto.remarks,
    });

    if (attendance.checkInTime && attendance.checkOutTime) {
      const diffMs =
        attendance.checkOutTime.getTime() - attendance.checkInTime.getTime();
      attendance.workingHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
    }

    return attendance.save();
  }

  /**
   * Delete attendance record
   */
  async delete(id: string) {
    const attendance = await this.attendanceModel.findByIdAndDelete(id);
    if (!attendance) {
      throw new NotFoundException('Attendance record not found');
    }
    return attendance;
  }

  /**
   * Get attendance statistics
   */
  async getStatistics(month: string) {
    const startDate = `${month}-01`;
    const year = parseInt(month.split('-')[0]);
    const monthNum = parseInt(month.split('-')[1]);
    const lastDay = new Date(year, monthNum, 0).getDate();
    const endDate = `${month}-${lastDay}`;

    const records = await this.attendanceModel.find({
      date: { $gte: startDate, $lte: endDate },
    });

    const stats = {
      totalRecords: records.length,
      present: records.filter((r) => r.status === 'Present').length,
      absent: records.filter((r) => r.status === 'Absent').length,
      late: records.filter((r) => r.status === 'Late').length,
      halfDay: records.filter((r) => r.status === 'Half Day').length,
      leave: records.filter((r) => r.status === 'Leave').length,
      averageWorkingHours:
        records.length > 0
          ? records.reduce((sum, r) => sum + (r.workingHours || 0), 0) /
            records.length
          : 0,
    };

    return stats;
  }
}
