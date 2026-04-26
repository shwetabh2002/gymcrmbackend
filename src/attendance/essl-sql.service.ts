import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mssql from 'mssql';

export interface EsslSqlAttendanceRow {
  SNO: number;
  UserId: string | null;
  EmployeeCode: string | null;
  LogDateTime: Date | string | null;
  LogDate: Date | string | null;
  LogTime: Date | string | null;
  Direction: string | null;
  Device: string | null;
}

@Injectable()
export class EsslSqlService {
  private readonly logger = new Logger(EsslSqlService.name);
  private pool: mssql.ConnectionPool | null = null;

  constructor(private readonly configService: ConfigService) {}

  private get host(): string {
    return this.configService.get<string>('ESSL_SQL_HOST')?.trim() || '';
  }

  private get port(): number {
    const raw = this.configService.get<string>('ESSL_SQL_PORT')?.trim() || '1433';
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 1433;
  }

  private get user(): string {
    return this.configService.get<string>('ESSL_SQL_USER')?.trim() || '';
  }

  private get password(): string {
    return this.configService.get<string>('ESSL_SQL_PASSWORD')?.trim() || '';
  }

  private get database(): string {
    return this.configService.get<string>('ESSL_SQL_DATABASE')?.trim() || '';
  }

  getMissingEnvForSql(): string[] {
    const missing: string[] = [];
    if (!this.host) missing.push('ESSL_SQL_HOST');
    if (!this.user) missing.push('ESSL_SQL_USER');
    if (!this.password) missing.push('ESSL_SQL_PASSWORD');
    if (!this.database) missing.push('ESSL_SQL_DATABASE');
    return missing;
  }

  isReadyForSql(): boolean {
    return this.getMissingEnvForSql().length === 0;
  }

  private async getPool(): Promise<mssql.ConnectionPool> {
    if (this.pool?.connected) return this.pool;

    if (!this.isReadyForSql()) {
      throw new Error(`Missing SQL env: ${this.getMissingEnvForSql().join(', ')}`);
    }

    const cfg: mssql.config = {
      server: this.host,
      port: this.port,
      user: this.user,
      password: this.password,
      database: this.database,
      options: {
        encrypt: false,
        trustServerCertificate: true,
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30_000,
      },
      connectionTimeout: 15_000,
      requestTimeout: 30_000,
    };

    this.pool = await new mssql.ConnectionPool(cfg).connect();
    this.logger.log(
      `Connected to eSSL SQL ${this.host}:${this.port}/${this.database} as ${this.user}`,
    );
    return this.pool;
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    await this.pool.close();
    this.pool = null;
  }

  async checkSqlReachable(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isReadyForSql()) {
      return { ok: false, error: `Missing SQL env: ${this.getMissingEnvForSql().join(', ')}` };
    }
    try {
      const pool = await this.getPool();
      await pool.request().query('SELECT 1 AS ok');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getMaxSno(): Promise<number | null> {
    const pool = await this.getPool();
    const rs = await pool
      .request()
      .query<{ maxSno: number | null }>('SELECT MAX(SNO) AS maxSno FROM dbo.AttendanceData');
    return rs.recordset[0]?.maxSno ?? null;
  }

  async fetchRowsByDateTimeRange(from: Date, to: Date): Promise<EsslSqlAttendanceRow[]> {
    const pool = await this.getPool();
    const rs = await pool
      .request()
      .input('fromDt', mssql.DateTime2, from)
      .input('toDt', mssql.DateTime2, to).query<EsslSqlAttendanceRow>(`
        SELECT
          SNO, UserId, EmployeeCode, LogDateTime, LogDate, LogTime, Direction, Device
        FROM dbo.AttendanceData
        WHERE LogDateTime >= @fromDt
          AND LogDateTime <= @toDt
        ORDER BY SNO ASC
      `);
    return rs.recordset;
  }

  async fetchRowsAfterSno(afterSno: number, limit = 500): Promise<EsslSqlAttendanceRow[]> {
    const maxRows = Math.max(1, Math.min(5000, Math.floor(limit)));
    const pool = await this.getPool();
    const rs = await pool
      .request()
      .input('afterSno', mssql.Int, afterSno).query<EsslSqlAttendanceRow>(`
        SELECT TOP (${maxRows})
          SNO, UserId, EmployeeCode, LogDateTime, LogDate, LogTime, Direction, Device
        FROM dbo.AttendanceData
        WHERE SNO > @afterSno
        ORDER BY SNO ASC
      `);
    return rs.recordset;
  }
}
