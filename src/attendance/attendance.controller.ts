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
import { SyncEsslDto } from './dto/sync-essl.dto';
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
    this.logger.log(
      `[AttendanceFunnel] HTTP POST /attendance/push ip=${req.ip} userId=${data?.UserID ?? data?.userId ?? '—'}`,
    );
    this.logger.debug(`📥 push body: ${JSON.stringify(data)}`);

    return this.attendanceService.processPushData(data, req.ip);
  }

  /**
   * Alternative endpoint for ADMS mode devices
   * POST /attendance/cdata
   *
   * Many ESSL devices in ADMS mode push to /cdata endpoint
   */
  @Post('cdata')
  @HttpCode(HttpStatus.OK)
  async receiveADMSData(@Body() data: any, @Req() req: any) {
    this.logger.log(
      `[AttendanceFunnel] HTTP POST /attendance/cdata ip=${req.ip} keys=${data && typeof data === 'object' ? Object.keys(data).join(',') : '—'}`,
    );
    this.logger.debug(`ADMS body: ${JSON.stringify(data)}`);

    return this.attendanceService.processPushData(data, req.ip);
  }

  /**
   * CRM troubleshooting: row counts, employee device-id coverage, eSSL config.
   * GET /attendance/diagnostics?month=2026-04
   */
  @Get('diagnostics')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getDiagnostics(
    @Req() req: any,
    @Query('month') month?: string,
  ) {
    this.logger.debug(
      `[AttendanceFunnel] HTTP GET /attendance/diagnostics user=${req.user?.userId ?? '—'} month=${month ?? '—'}`,
    );
    return this.attendanceService.getCrmDiagnostics(month);
  }

  /**
   * eSSL SOAP fetch + parse only (no save). See if the server returns log lines.
   * GET /attendance/essl-probe?from=2026-04-24&to=2026-04-30
   */
  @Get('essl-probe')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async esslProbe(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    this.logger.log(
      `[AttendanceFunnel] HTTP GET /attendance/essl-probe user=${req.user?.userId ?? '—'} from=${from ?? '—'} to=${to ?? '—'}`,
    );
    return this.attendanceService.esslProbe(from, to);
  }

  /**
   * Get all attendance records with filters
   * GET /attendance?employeeId=xxx&month=2026-04
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async findAll(@Req() req: any, @Query() query: QueryAttendanceDto) {
    this.logger.log(
      `[AttendanceFunnel] HTTP GET /attendance user=${req.user?.userId ?? '—'} query=${JSON.stringify(query)}`,
    );
    return this.attendanceService.findAll(query);
  }

  /**
   * Get today's attendance
   * GET /attendance/today
   */
  @Get('today')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getToday(@Req() req: any) {
    this.logger.debug(
      `[AttendanceFunnel] HTTP GET /attendance/today user=${req.user?.userId ?? '—'}`,
    );
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
   * Whether eSSL env is complete (no secrets returned). Use before sync from UI.
   * GET /attendance/essl-status
   */
  @Get('essl-status')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  getEsslStatus() {
    return this.attendanceService.getEsslSyncStatus();
  }

  /**
   * Pull transaction logs and import punches.
   * Source is auto-selected:
   * - SQL (when ESSL_SYNC_SOURCE=sql or SQL env is configured), or
   * - SOAP WebAPIService (legacy).
   * Configure ESSL_* env vars on the server.
   * POST /attendance/sync-essl  body optional: { "from": "2026-04-01", "to": "2026-04-16" }
   */
  @Post('sync-essl')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncEssl(@Req() req: any, @Body() dto: SyncEsslDto) {
    this.logger.log(
      `[AttendanceFunnel] HTTP POST /attendance/sync-essl user=${req.user?.userId ?? '—'} body=${JSON.stringify(dto ?? {})}`,
    );
    return this.attendanceService.syncFromEsslWebApi(dto);
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
