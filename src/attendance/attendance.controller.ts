import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { DevicePushDto } from './dto/device-push.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { ManualAttendanceDto } from './dto/manual-attendance.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('attendance')
export class AttendanceController {
  private readonly logger = new Logger(AttendanceController.name);

  constructor(private readonly attendanceService: AttendanceService) {}

  /**
   * Endpoint for ESSL K30 Pro device to push attendance data
   * POST /attendance/push
   *
   * This endpoint receives real-time attendance data from the fingerprint device
   * Configure this URL in the K30 Pro device's "Cloud Server" settings
   */
  @Post('push')
  @HttpCode(HttpStatus.OK)
  async receivePushData(@Body() data: DevicePushDto, @Req() req: any) {
    this.logger.log(`📥 Attendance push received from IP: ${req.ip}`);
    this.logger.debug(`Data: ${JSON.stringify(data)}`);

    return this.attendanceService.processPushData(data, req.ip);
  }

  /**
   * Get all attendance records with filters
   * GET /attendance?employeeId=xxx&month=2026-04
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() query: QueryAttendanceDto) {
    return this.attendanceService.findAll(query);
  }

  /**
   * Get today's attendance
   * GET /attendance/today
   */
  @Get('today')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getToday() {
    return this.attendanceService.getTodayAttendance();
  }

  /**
   * Get attendance statistics for a month
   * GET /attendance/statistics?month=2026-04
   */
  @Get('statistics')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getStatistics(@Query('month') month: string) {
    if (!month) {
      // Default to current month
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    return this.attendanceService.getStatistics(month);
  }

  /**
   * Get attendance for specific employee
   * GET /attendance/employee/:employeeId?month=2026-04
   */
  @Get('employee/:employeeId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getByEmployee(
    @Param('employeeId') employeeId: string,
    @Query('month') month?: string,
  ) {
    return this.attendanceService.findByEmployee(employeeId, month);
  }

  /**
   * Manually create/update attendance record
   * POST /attendance/manual
   */
  @Post('manual')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createManual(@Body() dto: ManualAttendanceDto) {
    return this.attendanceService.createManual(dto);
  }

  /**
   * Delete attendance record
   * DELETE /attendance/:id
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.attendanceService.delete(id);
    return { message: 'Attendance record deleted successfully' };
  }
}
