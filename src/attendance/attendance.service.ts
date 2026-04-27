import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Attendance, AttendanceDocument } from './schemas/attendance.schema';
import { DevicePushDto } from './dto/device-push.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { ManualAttendanceDto } from './dto/manual-attendance.dto';
import { SyncEsslDto } from './dto/sync-essl.dto';
import { EmployeesService } from '../employees/employees.service';
import { EsslWebApiService } from './essl-web-api.service';
import { EsslSqlAttendanceRow, EsslSqlService } from './essl-sql.service';
import { formatFunnel, newFunnelId } from './attendance-funnel.util';

export type AttendancePushSource = 'device' | 'essl-sync';

export interface ProcessPushDataOptions {
  funnelId?: string;
  source?: AttendancePushSource;
  lineInBatch?: { index: number; total: number };
}

@Injectable()
export class AttendanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttendanceService.name);
  private realtimeSqlTimer: NodeJS.Timeout | null = null;
  private realtimeSqlRunning = false;
  private lastSeenSqlSno: number | null = null;

  constructor(
    @InjectModel(Attendance.name)
    private attendanceModel: Model<AttendanceDocument>,
    private employeesService: EmployeesService,
    private readonly configService: ConfigService,
    private readonly esslWebApiService: EsslWebApiService,
    private readonly esslSqlService: EsslSqlService,
  ) {}

  async onModuleInit() {
    if (!this.shouldRunRealtimeSqlSync()) return;
    if (!this.esslSqlService.isReadyForSql()) {
      this.logger.warn(
        `Realtime SQL sync disabled: missing ${this.esslSqlService.getMissingEnvForSql().join(', ')}`,
      );
      return;
    }
    try {
      this.lastSeenSqlSno = await this.esslSqlService.getMaxSno();
      this.logger.log(
        `Realtime SQL sync armed at SNO=${this.lastSeenSqlSno ?? 'null'} (new rows only)`,
      );
    } catch (e) {
      this.logger.warn(
        `Realtime SQL sync could not read current SNO: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const everyMs = this.getRealtimeSqlIntervalMs();
    this.realtimeSqlTimer = setInterval(() => {
      void this.runRealtimeSqlTick();
    }, everyMs);
    this.logger.log(`Realtime SQL sync started (interval=${Math.round(everyMs / 1000)}s)`);
  }

  async onModuleDestroy() {
    if (this.realtimeSqlTimer) {
      clearInterval(this.realtimeSqlTimer);
      this.realtimeSqlTimer = null;
    }
    await this.esslSqlService.close();
  }

  /**
   * Process attendance data pushed from ESSL K30 Pro device
   */
  async processPushData(
    data: DevicePushDto,
    deviceIp?: string,
    options?: ProcessPushDataOptions,
  ) {
    const source = options?.source ?? 'device';
    const fid = options?.funnelId;
    const batch = options?.lineInBatch;
    try {
      if (source === 'essl-sync') {
        this.logger.debug(
          formatFunnel(
            fid,
            `apply try ${batch ? `${batch.index}/${batch.total} ` : ''}` +
              `userId=${data.UserID ?? data.userId} t=${String(data.DateTime ?? data.punchTime ?? '—')}`,
          ),
        );
      } else {
        this.logger.log(
          formatFunnel(
            fid,
            `device-push ip=${deviceIp ?? '—'} userId=${data.UserID ?? data.userId ?? '—'}`,
          ),
        );
        this.logger.debug(
          formatFunnel(fid, `device payload ${JSON.stringify(data)}`),
        );
      }

      // Extract data (handle different field name formats)
      const deviceUserId = String(
        data.UserID ?? data.userId ?? '',
      ).trim();
      const punchTimeRaw = data.DateTime || data.punchTime;
      const deviceSN = data.SN || data.deviceSerialNumber;

      if (!deviceUserId || !punchTimeRaw) {
        this.logger.warn(
          formatFunnel(fid, 'reject: missing userId or punchTime'),
        );
        return { success: false, message: 'Missing required fields' };
      }

      // Find employee by deviceUserId
      const employee = await this.employeesService.findByDeviceUserId(
        deviceUserId,
      );

      if (!employee) {
        this.logger.warn(
          formatFunnel(
            fid,
            `reject: no CRM employee for device user id ${deviceUserId} (set Biometric device user ID)`,
          ),
        );
        return {
          success: false,
          message: `Employee not found for device user ID: ${deviceUserId}`,
        };
      }

      // Parse punch time (eSSL may send "2026-04-24 9:5:1" or space-separated)
      const punchTime = this.normalizePunchDateTimeString(String(punchTimeRaw));
      const punchDateTime = new Date(punchTime);
      if (isNaN(punchDateTime.getTime())) {
        this.logger.warn(
          formatFunnel(fid, `reject: unparseable punch time ${String(punchTimeRaw)}`),
        );
        return { success: false, message: 'Invalid punch time' };
      }
      const date = this.getDateYmdInTimeZone(
        punchDateTime,
        this.configService.get<string>('APP_TIMEZONE')?.trim() || 'Asia/Kolkata',
      );

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
        const isDuplicatePunch = attendance.allPunches.some(
          (p) => new Date(p).getTime() === punchDateTime.getTime(),
        );
        if (isDuplicatePunch) {
          return {
            success: true,
            message: 'Duplicate punch skipped',
            data: attendance,
          };
        }

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

      const successMsg =
        source === 'essl-sync'
          ? `saved punch → ${employee.name} date=${date} (${deviceUserId})`
          : `saved punch → ${employee.name} on ${date} at ${punchDateTime.toLocaleTimeString()}`;
      if (source === 'essl-sync') {
        this.logger.debug(formatFunnel(fid, successMsg));
      } else {
        this.logger.log(formatFunnel(fid, successMsg));
      }

      return {
        success: true,
        message: 'Attendance recorded successfully',
        data: attendance,
      };
    } catch (error) {
      this.logger.error(
        formatFunnel(fid, `error processing push: ${String(error)}`),
        error,
      );
      throw error;
    }
  }

  /**
   * Get attendance records with filters
   */
  async findAll(query: QueryAttendanceDto) {
    if (this.shouldUseSqlSync() && this.esslSqlService.isReadyForSql()) {
      return this.findAllFromSql(query);
    }
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
      const { startDate, endDate } = this.monthKeyToDateRange(query.month);
      filter.date = { $gte: startDate, $lte: endDate };
    }

    this.logger.debug(
      formatFunnel(
        undefined,
        `list filter=${JSON.stringify(filter)} (month=${query.month ?? '—'})`,
      ),
    );
    const rows = await this.attendanceModel
      .find(filter)
      .populate('employeeId', 'name phone email employeeType')
      .sort({ date: -1 })
      .exec();
    this.logger.debug(
      formatFunnel(undefined, `list → ${rows.length} document(s) returned`),
    );
    return rows;
  }

  /**
   * Get attendance for specific employee
   */
  async findByEmployee(employeeId: string, month?: string) {
    const filter: any = { employeeId };

    if (month) {
      const { startDate, endDate } = this.monthKeyToDateRange(month);
      filter.date = { $gte: startDate, $lte: endDate };
    }

    return this.attendanceModel.find(filter).sort({ date: -1 }).exec();
  }

  /**
   * Get today's attendance (calendar day in APP_TIMEZONE — not UTC)
   */
  async getTodayAttendance() {
    if (this.shouldUseSqlSync() && this.esslSqlService.isReadyForSql()) {
      return this.getTodayAttendanceFromSql();
    }
    const tz = this.configService.get<string>('APP_TIMEZONE')?.trim() || 'Asia/Kolkata';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    this.logger.debug(
      formatFunnel(undefined, `today: ymd=${today} tz=${tz}`),
    );
    const rows = await this.attendanceModel
      .find({ date: today })
      .populate('employeeId', 'name phone email employeeType')
      .sort({ checkInTime: 1 })
      .exec();
    this.logger.debug(
      formatFunnel(undefined, `today → ${rows.length} row(s)`),
    );
    return rows;
  }

  private async findAllFromSql(query: QueryAttendanceDto) {
    const tz = this.configService.get<string>('APP_TIMEZONE')?.trim() || 'Asia/Kolkata';
    let from: Date;
    let to: Date;

    if (query.startDate && query.endDate) {
      if (this.isYmd(query.startDate) && this.isYmd(query.endDate)) {
        const a = this.ymdStartEndInZone(query.startDate, tz);
        const b = this.ymdStartEndInZone(query.endDate, tz);
        from = a.start;
        to = b.end;
      } else {
        from = new Date(query.startDate);
        to = new Date(query.endDate);
      }
    } else if (query.month) {
      const { startDate, endDate } = this.monthKeyToDateRange(query.month);
      const a = this.ymdStartEndInZone(startDate, tz);
      const b = this.ymdStartEndInZone(endDate, tz);
      from = a.start;
      to = b.end;
    } else {
      const r = this.lastNCalendarDayRangeYmd(31, tz);
      from = r.from;
      to = r.to;
    }

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date range for attendance list');
    }
    const rows = await this.esslSqlService.fetchRowsByDateTimeRange(from, to);
    const mapped = await this.mapSqlRowsToAttendanceRows(rows);
    return mapped.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  private async getTodayAttendanceFromSql() {
    const tz = this.configService.get<string>('APP_TIMEZONE')?.trim() || 'Asia/Kolkata';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const a = this.ymdStartEndInZone(today, tz);
    const rows = await this.esslSqlService.fetchRowsByDateTimeRange(a.start, a.end);
    const mapped = await this.mapSqlRowsToAttendanceRows(rows);
    return mapped.sort((x, y) => {
      const xt = x.checkInTime ? new Date(x.checkInTime).getTime() : 0;
      const yt = y.checkInTime ? new Date(y.checkInTime).getTime() : 0;
      return xt - yt;
    });
  }

  private normalizeDeviceIdForMatch(v: string): string {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (/^\d+$/.test(s)) return String(parseInt(s, 10));
    return s.toLowerCase();
  }

  private async mapSqlRowsToAttendanceRows(rows: EsslSqlAttendanceRow[]) {
    const employees = await this.employeesService.findAll();
    const byDevice = new Map<string, any>();
    for (const e of employees) {
      const raw = String((e as any).deviceUserId ?? '').trim();
      if (!raw) continue;
      byDevice.set(this.normalizeDeviceIdForMatch(raw), e);
      byDevice.set(raw, e);
      if (/^\d+$/.test(raw)) {
        byDevice.set(raw.padStart(2, '0'), e);
      }
    }

    return rows.map((r) => {
      const deviceUserId = String(r.UserId ?? r.EmployeeCode ?? '').trim();
      const employee = byDevice.get(this.normalizeDeviceIdForMatch(deviceUserId)) ?? null;
      const dtText = this.toSqlLocalDateTimeText(r.LogDateTime);
      const date = dtText ? dtText.slice(0, 10) : '';
      const direction = String(r.Direction ?? '').trim();

      return {
        _id: `sql-${r.SNO}-${deviceUserId || 'na'}`,
        employeeId: employee
          ? {
              _id: String(employee._id),
              name: employee.name,
              phone: employee.phone,
              email: employee.email,
              employeeType: employee.employeeType,
            }
          : null,
        employeeName: employee?.name ?? 'Unknown Employee',
        deviceUserId: deviceUserId || '',
        date,
        checkInTime: dtText ?? undefined,
        checkOutTime: dtText ?? undefined,
        allPunches: dtText ? [dtText] : [],
        status: direction || '—',
        deviceSerialNumber: String(r.Device ?? '').trim() || undefined,
        remarks: direction || undefined,
      };
    });
  }

  /** Preserve SQL wall-clock datetime without UTC conversion. */
  private toSqlLocalDateTimeText(v: string | Date | null | undefined): string | null {
    if (v == null) return null;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return null;
      // SQL CONVERT(120) gives "YYYY-MM-DD HH:mm:ss" -> make it ISO-like (no timezone).
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
        return s.replace(' ', 'T');
      }
      // Already ISO-ish; keep clock as-is (strip trailing Z if present).
      if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
        return s.replace(/Z$/, '');
      }
      return s;
    }
    if (!(v instanceof Date) || isNaN(v.getTime())) return null;
    // Fallback only if driver gave a Date object.
    const y = v.getFullYear();
    const mo = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    const h = String(v.getHours()).padStart(2, '0');
    const mi = String(v.getMinutes()).padStart(2, '0');
    const se = String(v.getSeconds()).padStart(2, '0');
    return `${y}-${mo}-${d}T${h}:${mi}:${se}`;
  }

  /** YYYY-MM-DD in IANA zone (e.g. Asia/Kolkata). */
  private getDateYmdInTimeZone(d: Date, timeZone: string): string {
    return d.toLocaleDateString('en-CA', { timeZone });
  }

  /**
   * Normalizes eSSL "2026-04-24 9:5:1" style strings for Date parsing.
   */
  private normalizePunchDateTimeString(raw: string): string {
    const s = raw.trim();
    const m = s.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/,
    );
    if (m) {
      const y = m[1];
      const mo = m[2].padStart(2, '0');
      const day = m[3].padStart(2, '0');
      const h = m[4].padStart(2, '0');
      const min = m[5].padStart(2, '0');
      const sec = m[6].padStart(2, '0');
      return `${y}-${mo}-${day}T${h}:${min}:${sec}`;
    }
    return s.replace(' ', 'T');
  }

  private isYmd(s: string | undefined): s is string {
    return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  /**
   * Normalizes "2026-4" / "2026/04" → padded YYYY-MM and YYYY-MM-DD range for
   * string `date` filters. Unpadded months break lexicographic compare vs stored "2026-04-24".
   */
  private monthKeyToDateRange(ymRaw: string): {
    label: string;
    startDate: string;
    endDate: string;
  } {
    const parts = ymRaw.trim().split(/[-/]/).filter(Boolean);
    if (parts.length < 2) {
      throw new BadRequestException(
        `Invalid month "${ymRaw}" (use YYYY-MM, e.g. 2026-04)`,
      );
    }
    const y = parseInt(parts[0], 10);
    const mo = parseInt(parts[1], 10);
    if (!y || mo < 1 || mo > 12) {
      throw new BadRequestException(
        `Invalid month "${ymRaw}" (use YYYY-MM, e.g. 2026-04)`,
      );
    }
    const label = `${y}-${String(mo).padStart(2, '0')}`;
    const startDate = `${label}-01`;
    const lastDay = new Date(y, mo, 0).getDate();
    const endDate = `${label}-${String(lastDay).padStart(2, '0')}`;
    return { label, startDate, endDate };
  }

  private tryMonthKeyToDateRange(
    ymRaw: string | undefined,
  ): { label: string; startDate: string; endDate: string } | null {
    if (!ymRaw?.trim()) return null;
    try {
      return this.monthKeyToDateRange(ymRaw);
    } catch {
      return null;
    }
  }

  /**
   * First/last instants in `timeZone` for calendar YYYY-MM-DD (matches HTML date input).
   */
  private ymdStartEndInZone(ymd: string, timeZone: string): { start: Date; end: Date } {
    const [Y, M, D] = ymd.split('-').map((x) => parseInt(x, 10));
    if (!Y || M < 1 || M > 12 || D < 1 || D > 31) {
      throw new BadRequestException('from/to must be YYYY-MM-DD');
    }
    const dtf = (t: number) =>
      new Date(t).toLocaleDateString('en-CA', { timeZone });
    const startScan = Date.UTC(Y, M - 1, D, 12, 0, 0) - 1 * 24 * 60 * 60 * 1000;
    const endScan = Date.UTC(Y, M - 1, D, 12, 0, 0) + 2 * 24 * 60 * 60 * 1000;
    let first = -1;
    let last = -1;
    for (let t = startScan; t < endScan; t += 60 * 1000) {
      if (dtf(t) === ymd) {
        if (first < 0) first = t;
        last = t;
      }
    }
    if (first < 0) {
      const wStart = Date.UTC(Y, M - 1, D, 0, 0, 0) - 4 * 24 * 60 * 60 * 1000;
      const wEnd = Date.UTC(Y, M - 1, D, 0, 0, 0) + 4 * 24 * 60 * 60 * 1000;
      for (let t = wStart; t < wEnd; t += 60 * 1000) {
        if (dtf(t) === ymd) {
          if (first < 0) first = t;
          last = t;
        }
      }
    }
    if (first < 0) {
      throw new BadRequestException(
        `No such calendar day: ${ymd} (in ${timeZone})`,
      );
    }
    return {
      start: new Date(first),
      end: new Date((last as number) + 59_999),
    };
  }

  private previousCalendarYmd(ymd: string, timeZone: string): string {
    const { start } = this.ymdStartEndInZone(ymd, timeZone);
    return this.getDateYmdInTimeZone(new Date(start.getTime() - 1), timeZone);
  }

  /**
   * Last N **inclusive** calendar days in `timeZone` (today + N−1 prior), with full-day
   * bounds (matches eTimeTrack “Device Log” month/day filters better than rolling 168h).
   */
  private lastNCalendarDayRangeYmd(
    n: number,
    timeZone: string,
  ): { fromYmd: string; toYmd: string; from: Date; to: Date } {
    if (n < 1) {
      throw new BadRequestException('n must be >= 1');
    }
    const toYmd = this.getDateYmdInTimeZone(new Date(), timeZone);
    let y = toYmd;
    for (let i = 0; i < n - 1; i++) {
      y = this.previousCalendarYmd(y, timeZone);
    }
    const fromYmd = y;
    const a = this.ymdStartEndInZone(fromYmd, timeZone);
    const b = this.ymdStartEndInZone(toYmd, timeZone);
    return { fromYmd, toYmd, from: a.start, to: b.end };
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
    const { startDate, endDate } = this.monthKeyToDateRange(month);

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

  /**
   * Pull logs from eTimeTrackLite SOAP API (GetTransactionsLog) and apply each punch
   * like a device push. Employees must have matching device user id on file.
   */
  /**
   * Non-secret status for UI: whether sync can run and what is missing.
   */
  getEsslSyncStatus() {
    const missing = this.esslWebApiService.getMissingEnvForSync();
    const missingSql = this.esslSqlService.getMissingEnvForSql();
    return {
      ready: this.shouldUseSqlSync()
        ? this.esslSqlService.isReadyForSql()
        : this.esslWebApiService.isReadyForSync(),
      source: this.shouldUseSqlSync() ? 'sql' : 'soap',
      missingEnvVars: missing,
      missingSqlEnvVars: missingSql,
      webApiHost: this.esslWebApiService.getConfiguredUrlHost(),
      sqlHost: this.configService.get<string>('ESSL_SQL_HOST')?.trim() || null,
      sqlDatabase: this.configService.get<string>('ESSL_SQL_DATABASE')?.trim() || null,
    };
  }

  /**
   * Why CRM might show no rows: DB counts, employee↔device mapping, optional month count.
   */
  async getCrmDiagnostics(month?: string) {
    const totalAttendance = await this.attendanceModel.countDocuments();
    const essl = this.getEsslSyncStatus();
    const esslAsmxReachable =
      await this.esslWebApiService.checkAsmxHttpReachable();
    const esslSqlReachable = await this.esslSqlService.checkSqlReachable();
    const employeesTotal = await this.employeesService.countEmployees();
    const employeesWithDeviceId =
      await this.employeesService.countWithDeviceUserIdSet();

    let forMonth: { month: string; count: number } | undefined;
    let invalidMonthNote: string | undefined;
    if (month) {
      const range = this.tryMonthKeyToDateRange(month);
      if (range) {
        const count = await this.attendanceModel
          .countDocuments({
            date: { $gte: range.startDate, $lte: range.endDate },
          })
          .exec();
        forMonth = { month: range.label, count };
      } else {
        forMonth = { month: month.trim(), count: 0 };
        invalidMonthNote = `Invalid month query "${month}" — use YYYY-MM (e.g. 2026-04) so the table filter matches stored dates.`;
      }
    }

    const issues: string[] = [];
    if (invalidMonthNote) {
      issues.push(invalidMonthNote);
    }
    if (employeesWithDeviceId === 0) {
      issues.push(
        'No employees have "device user id" set — sync cannot attach punches to anyone.',
      );
    }
    if (!essl.ready) {
      issues.push(
        essl.source === 'sql'
          ? 'eSSL SQL environment variables are incomplete on the server.'
          : 'eSSL SOAP environment variables are incomplete on the server.',
      );
    }
    if (forMonth && forMonth.count === 0 && totalAttendance > 0) {
      issues.push(
        `No attendance rows for ${forMonth.month}, but other months have data. Pick that month in the table or run sync for that range.`,
      );
    }
    if (forMonth && forMonth.count === 0 && totalAttendance === 0) {
      issues.push(
        'No attendance in database yet. Run eSSL sync and check "Last sync result" (lines read vs saved).',
      );
    }
    if (essl.ready && !esslAsmxReachable.ok) {
      issues.push(
        'This backend cannot reach ESSL_WEB_API_URL over HTTP. If the Nest process runs on the same LAN as the eSSL PC, set ESSL_WEB_API_URL to http://192.168.1.5:82/iclock/WebAPIService.asmx (device points to 192.168.1.5:82). Use the public IP only if Nest runs on the internet and the port is open.',
      );
    }
    if (essl.source === 'sql' && !esslSqlReachable.ok) {
      issues.push(
        `This backend cannot reach eSSL SQL (${this.configService.get<string>('ESSL_SQL_HOST') ?? 'host'}:${this.configService.get<string>('ESSL_SQL_PORT') ?? '1433'}). Check SQL auth, firewall, and remote access.`,
      );
    }

    const deviceUserMapping =
      await this.employeesService.listDeviceUserIdMapping();

    return {
      totalAttendance,
      forMonth: forMonth ?? null,
      employees: {
        total: employeesTotal,
        withDeviceUserId: employeesWithDeviceId,
      },
      deviceUserMapping,
      essl,
      esslAsmxReachable,
      esslSqlReachable,
      issues,
      /** How data moves from eSSL to this CRM (for operators). */
      flow: [
        'eSSL Device Log List shows User Id (e.g. 1, 2, 4) — same value as Biometric device user ID on each employee.',
        'Portal rows often use "Log date" as DD-MM-YYYY and TableName like DeviceLogs_4_2026; many installs align ESSL_STR_DATA_LIST (e.g. 4) with that middle number.',
        'Run eSSL sync (or device push to /attendance/push) → Nest finds employee by deviceUserId → saves Attendance for that calendar day (APP_TIMEZONE).',
        'Records (by month): pick YYYY-MM for that month (padded, e.g. 2026-04). Unpadded "2026-4" used to hide rows vs stored 2026-04-* dates — fixed server-side, still use 2026-04 in the UI.',
        'Today — live: only rows whose stored date is "today" in Asia/Kolkata (use after sync or push).',
      ],
    };
  }

  /**
   * Fetch eSSL log and parse lines only (no DB writes) — for troubleshooting.
   * Use the same `from`/`to` query as sync: YYYY-MM-DD or full ISO strings.
   */
  async esslProbe(fromQuery?: string, toQuery?: string) {
    const funnelId = newFunnelId();
    this.logger.log(
      formatFunnel(
        funnelId,
        `essl-probe: start from=${fromQuery ?? '—'} to=${toQuery ?? '—'}`,
      ),
    );
    if (!this.esslWebApiService.isReadyForSync()) {
      const missing = this.esslWebApiService.getMissingEnvForSync();
      this.logger.warn(
        formatFunnel(
          funnelId,
          `essl-probe: abort — missing env: ${missing.join(', ')}`,
        ),
      );
      throw new BadRequestException(
        `eSSL not configured: set ${missing.join(', ')}`,
      );
    }
    const tz = this.configService.get<string>('APP_TIMEZONE')?.trim() || 'Asia/Kolkata';
    let from: Date;
    let to: Date;
    let ymdOpt: { fromYmd?: string; toYmd?: string } | undefined;
    if (this.isYmd(fromQuery) && this.isYmd(toQuery)) {
      const a = this.ymdStartEndInZone(fromQuery, tz);
      const b = this.ymdStartEndInZone(toQuery, tz);
      if (a.start > b.end) {
        throw new BadRequestException('from must be before to');
      }
      from = a.start;
      to = b.end;
      ymdOpt = { fromYmd: fromQuery, toYmd: toQuery };
    } else if (fromQuery && toQuery) {
      from = new Date(fromQuery);
      to = new Date(toQuery);
      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        throw new BadRequestException('Invalid from/to — use YYYY-MM-DD or ISO date-time');
      }
    } else {
      const r = this.lastNCalendarDayRangeYmd(7, tz);
      from = r.from;
      to = r.to;
      ymdOpt = { fromYmd: r.fromYmd, toYmd: r.toYmd };
    }
    if (from > to) {
      throw new BadRequestException('from must be before to');
    }
    this.logger.log(
      formatFunnel(
        funnelId,
        `essl-probe: resolved window from=${from.toISOString()} to=${to.toISOString()}` +
          (ymdOpt?.fromYmd && ymdOpt?.toYmd
            ? ` · calendar ${ymdOpt.fromYmd}…${ymdOpt.toYmd}`
            : ''),
      ),
    );
    let xml: string;
    try {
      xml = await this.esslWebApiService.fetchTransactionsLogXml(
        from,
        to,
        ymdOpt,
        { funnelId },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        formatFunnel(funnelId, `essl-probe: SOAP/HTTP failed — ${msg}`),
      );
      return {
        funnelId,
        ok: false,
        error: msg,
        from: from.toISOString(),
        to: to.toISOString(),
        linesParsed: 0,
        sampleLines: [] as string[],
        xmlLength: 0,
      };
    }
    const lines = this.esslWebApiService.extractTransactionLines(xml);
    this.logger.log(
      formatFunnel(
        funnelId,
        `essl-probe: parse done — ${lines.length} line(s) (xml ${xml.length} bytes)`,
      ),
    );
    if (lines.length === 0) {
      this.logger.warn(
        formatFunnel(
          funnelId,
          this.esslWebApiService.summarizeZeroLineResponse(xml),
        ),
      );
    }
    return {
      funnelId,
      ok: true,
      from: from.toISOString(),
      to: to.toISOString(),
      linesParsed: lines.length,
      sampleLines: lines.slice(0, 5),
      xmlLength: xml.length,
      responseXmlPreview: this.esslWebApiService.previewResponseXml(xml),
    };
  }

  async syncFromEsslWebApi(dto?: SyncEsslDto) {
    const funnelId = newFunnelId();
    this.logger.log(
      formatFunnel(
        funnelId,
        `sync-essl: start dto=${JSON.stringify(dto ?? {})}`,
      ),
    );
    if (this.shouldUseSqlSync()) {
      return this.syncFromEsslSql(dto, funnelId);
    }
    if (!this.esslWebApiService.isReadyForSync()) {
      const missing = this.esslWebApiService.getMissingEnvForSync().join(', ');
      this.logger.warn(
        formatFunnel(
          funnelId,
          `sync-essl: abort — not configured: ${missing || 'ESSL_*'}`,
        ),
      );
      throw new BadRequestException(
        `eSSL Web API is not fully configured. Set: ${missing || 'ESSL_* variables'}.`,
      );
    }

    const tz = this.configService.get<string>('APP_TIMEZONE')?.trim() || 'Asia/Kolkata';
    let from: Date;
    let to: Date;
    let ymdOpt: { fromYmd?: string; toYmd?: string } | undefined;
    if (this.isYmd(dto?.from) && this.isYmd(dto?.to)) {
      const a = this.ymdStartEndInZone(dto!.from!, tz);
      const b = this.ymdStartEndInZone(dto!.to!, tz);
      if (a.start > b.end) {
        throw new BadRequestException('from must be before to');
      }
      from = a.start;
      to = b.end;
      ymdOpt = { fromYmd: dto!.from, toYmd: dto!.to };
    } else if (dto?.from && dto?.to) {
      from = new Date(dto.from);
      to = new Date(dto.to);
    } else if (dto?.from && !dto?.to) {
      from = new Date(dto.from);
      to = new Date();
    } else if (dto?.to && !dto?.from) {
      to = new Date(dto.to);
      from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      const r = this.lastNCalendarDayRangeYmd(7, tz);
      from = r.from;
      to = r.to;
      ymdOpt = { fromYmd: r.fromYmd, toYmd: r.toYmd };
    }

    if (from > to) {
      throw new BadRequestException('from must be before to');
    }

    this.logger.log(
      formatFunnel(
        funnelId,
        `sync-essl: window from=${from.toISOString()} to=${to.toISOString()}` +
          (ymdOpt?.fromYmd && ymdOpt?.toYmd
            ? ` · calendar YMD ${ymdOpt.fromYmd}…${ymdOpt.toYmd}`
            : ''),
      ),
    );

    const serial =
      this.configService.get<string>('ESSL_SERIAL_NUMBER')?.trim() || '';

    let xml: string;
    try {
      xml = await this.esslWebApiService.fetchTransactionsLogXml(
        from,
        to,
        ymdOpt,
        { funnelId },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        formatFunnel(
          funnelId,
          `sync-essl: SOAP/HTTP failed before parse — ${msg}`,
        ),
      );
      if (/unatho?ri[sz]ed|unauthori[sz]ed/i.test(msg)) {
        throw new BadRequestException(
          'eSSL Web API: Unauthorised User — the SOAP call rejected ESSL_API_USERNAME / ESSL_API_PASSWORD. ' +
            'In eTimeTrack, open System User, edit the same user, and enable Web Service / API / GetTransactionsLog if your build has that flag (this is not the same as only logging in to Main.aspx in a browser). ' +
            'Or create a dedicated API user and set ESSL_API_* in .env. If the server restricts clients by IP, allow the machine running this Nest app. ' +
            `Server message: ${msg}`,
        );
      }
      throw new BadRequestException(
        `eSSL request failed (check LAN reachability of Web API and credentials): ${msg}`,
      );
    }

    const lines = this.esslWebApiService.extractTransactionLines(xml);
    this.logger.log(
      formatFunnel(
        funnelId,
        `sync-essl: ${lines.length} line(s) to apply from parsed XML`,
      ),
    );
    if (lines.length === 0) {
      this.logger.warn(
        formatFunnel(
          funnelId,
          this.esslWebApiService.summarizeZeroLineResponse(xml),
        ),
      );
      this.logger.warn(
        formatFunnel(
          funnelId,
          'if empty repeatedly: set explicit From/To in CRM (match portal), verify ESSL_SERIAL_NUMBER, ESSL_STR_DATA_LIST; try ESSL_SOAP_DATE_FIELDS=date in .env',
        ),
      );
    }

    let applied = 0;
    let skipped = 0;
    let unparseable = 0;
    const errors: string[] = [];
    const total = lines.length;
    const progressEvery = 25;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parsed = this.esslWebApiService.parseLine(line);
      if (!parsed) {
        skipped++;
        unparseable++;
        if (unparseable <= 5) {
          this.logger.warn(
            formatFunnel(
              funnelId,
              `sync-essl: unparseable line[${i}]: ${line.replace(/\s+/g, ' ').slice(0, 120)}`,
            ),
          );
        } else if (unparseable === 6) {
          this.logger.warn(
            formatFunnel(
              funnelId,
              'sync-essl: more unparseable lines omitted (use DEBUG to trace all)',
            ),
          );
        }
        continue;
      }

      const push: DevicePushDto = {
        UserID: parsed.userId,
        DateTime: parsed.dateTime,
        SN: serial || undefined,
      };

      const result = await this.processPushData(push, undefined, {
        funnelId,
        source: 'essl-sync',
        lineInBatch: { index: i + 1, total },
      });
      if (result.success) {
        applied++;
      } else {
        skipped++;
        if (result.message && errors.length < 20) {
          errors.push(`${parsed.userId} @ ${parsed.dateTime}: ${result.message}`);
        }
      }
      if (total > 0 && (i + 1) % progressEvery === 0) {
        this.logger.log(
          formatFunnel(
            funnelId,
            `sync-essl: progress ${i + 1}/${total} — applied=${applied} skipped=${skipped}`,
          ),
        );
      }
    }

    let hint: string | undefined;
    if (lines.length === 0) {
      hint =
        'No transaction lines in this range — eSSL only returns punches on days that have logs (see Device Log List). If you only have data on e.g. 5 Apr, use From/To that include 5 Apr, not an empty week. Also check ESSL_STR_DATA_LIST, Nest logs, or try ESSL_SOAP_DATE_FIELDS=datetime.';
    } else if (applied === 0 && errors.length > 0) {
      hint =
        'Logs were read but no punches saved. In Employees, set "Biometric device user ID" to the same number as in eSSL for each person (see sample errors).';
    } else if (applied === 0 && lines.length > 0) {
      hint =
        'All lines were skipped. Map each eSSL user id to an employee in CRM (Employees → edit → Biometric device user ID).';
    }

    this.logger.log(
      formatFunnel(
        funnelId,
        `sync-essl: done — lines=${lines.length} applied=${applied} skipped=${skipped} (unparseable≈${unparseable})`,
      ),
    );

    return {
      success: true,
      funnelId,
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      linesParsed: lines.length,
      punchesApplied: applied,
      skippedOrNoMatch: skipped,
      sampleErrors: errors,
      hint,
      responseXmlPreview:
        lines.length === 0
          ? this.esslWebApiService.previewResponseXml(xml)
          : undefined,
    };
  }

  private shouldUseSqlSync(): boolean {
    const mode = this.configService
      .get<string>('ESSL_SYNC_SOURCE')
      ?.trim()
      .toLowerCase();
    if (mode === 'soap') return false;
    if (mode === 'sql') return true;
    return this.esslSqlService.isReadyForSql();
  }

  private shouldRunRealtimeSqlSync(): boolean {
    const v =
      this.configService
        .get<string>('ESSL_SQL_REALTIME_ENABLED')
        ?.trim()
        .toLowerCase() ?? '';
    if (v === '0' || v === 'false' || v === 'no') return false;
    return this.shouldUseSqlSync();
  }

  private getRealtimeSqlIntervalMs(): number {
    const raw = this.configService
      .get<string>('ESSL_SQL_REALTIME_INTERVAL_SECONDS')
      ?.trim();
    const seconds = raw ? parseInt(raw, 10) : 30;
    const safe = Number.isFinite(seconds) ? seconds : 30;
    return Math.max(10, safe) * 1000;
  }

  private resolveSyncWindow(
    dto?: SyncEsslDto,
  ): { from: Date; to: Date; ymdOpt?: { fromYmd?: string; toYmd?: string } } {
    const tz = this.configService.get<string>('APP_TIMEZONE')?.trim() || 'Asia/Kolkata';
    let from: Date;
    let to: Date;
    let ymdOpt: { fromYmd?: string; toYmd?: string } | undefined;
    if (this.isYmd(dto?.from) && this.isYmd(dto?.to)) {
      const a = this.ymdStartEndInZone(dto!.from!, tz);
      const b = this.ymdStartEndInZone(dto!.to!, tz);
      if (a.start > b.end) throw new BadRequestException('from must be before to');
      from = a.start;
      to = b.end;
      ymdOpt = { fromYmd: dto!.from, toYmd: dto!.to };
    } else if (dto?.from && dto?.to) {
      from = new Date(dto.from);
      to = new Date(dto.to);
    } else if (dto?.from && !dto?.to) {
      from = new Date(dto.from);
      to = new Date();
    } else if (dto?.to && !dto?.from) {
      to = new Date(dto.to);
      from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      const r = this.lastNCalendarDayRangeYmd(7, tz);
      from = r.from;
      to = r.to;
      ymdOpt = { fromYmd: r.fromYmd, toYmd: r.toYmd };
    }
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Invalid from/to — use YYYY-MM-DD or ISO date-time');
    }
    if (from > to) throw new BadRequestException('from must be before to');
    return { from, to, ymdOpt };
  }

  private async syncFromEsslSql(dto: SyncEsslDto | undefined, funnelId: string) {
    if (!this.esslSqlService.isReadyForSql()) {
      throw new BadRequestException(
        `eSSL SQL is not fully configured. Set: ${this.esslSqlService.getMissingEnvForSql().join(', ')}.`,
      );
    }

    const { from, to, ymdOpt } = this.resolveSyncWindow(dto);
    this.logger.log(
      formatFunnel(
        funnelId,
        `sync-sql: window from=${from.toISOString()} to=${to.toISOString()}` +
          (ymdOpt?.fromYmd && ymdOpt?.toYmd ? ` · calendar YMD ${ymdOpt.fromYmd}…${ymdOpt.toYmd}` : ''),
      ),
    );

    const rows = await this.esslSqlService.fetchRowsByDateTimeRange(from, to);
    const mapped = await this.mapSqlRowsToAttendanceRows(rows);
    const mappedCount = mapped.filter((x) => x.employeeId != null).length;
    const skipped = rows.length - mapped.length;
    for (const r of rows) {
      if (r.SNO != null) {
        this.lastSeenSqlSno = Math.max(this.lastSeenSqlSno ?? r.SNO, r.SNO);
      }
    }

    return {
      success: true,
      funnelId,
      source: 'sql',
      range: { from: from.toISOString(), to: to.toISOString() },
      linesParsed: rows.length,
      punchesApplied: mappedCount,
      skippedOrNoMatch: skipped,
      sampleErrors: [],
      hint:
        rows.length === 0
          ? 'No SQL attendance rows in selected date range.'
          : mappedCount === 0
            ? 'Rows were read but none mapped to employees. Set Biometric device user ID on Employees.'
            : undefined,
    };
  }

  private async runRealtimeSqlTick(): Promise<void> {
    if (!this.shouldRunRealtimeSqlSync()) return;
    if (this.realtimeSqlRunning) return;
    this.realtimeSqlRunning = true;
    const funnelId = newFunnelId();
    try {
      const after = this.lastSeenSqlSno ?? 0;
      const rows = await this.esslSqlService.fetchRowsAfterSno(after, 500);
      if (rows.length === 0) return;

      for (const row of rows) {
        if (row.SNO != null) {
          this.lastSeenSqlSno = Math.max(this.lastSeenSqlSno ?? row.SNO, row.SNO);
        }
      }

      this.logger.log(
        formatFunnel(
          funnelId,
          `realtime-sql: observed ${rows.length} new SQL row(s), lastSno=${this.lastSeenSqlSno ?? 'null'}`,
        ),
      );
    } catch (e) {
      this.logger.warn(
        formatFunnel(
          funnelId,
          `realtime-sql: tick failed — ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    } finally {
      this.realtimeSqlRunning = false;
    }
  }
}
