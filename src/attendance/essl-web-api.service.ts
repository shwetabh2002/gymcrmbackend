import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

/**
 * eTimeTrackLite / eSSL Web API (SOAP) — GetTransactionsLog
 * @see https://www.esslsecurity.com/etimetracklite-web-integration
 */
@Injectable()
export class EsslWebApiService {
  private readonly logger = new Logger(EsslWebApiService.name);

  constructor(private readonly configService: ConfigService) {}

  private getAppTimeZone(): string {
    return this.configService.get<string>('APP_TIMEZONE')?.trim() || 'Asia/Kolkata';
  }

  isConfigured(): boolean {
    return !!this.getServiceUrl();
  }

  /** True when URL + API user/password + device serial are set (required for GetTransactionsLog). */
  isReadyForSync(): boolean {
    return !!(
      this.getServiceUrl() &&
      this.getUser() &&
      this.getPassword() &&
      this.getSerial()
    );
  }

  /** Which env vars are still missing (no secrets). */
  getMissingEnvForSync(): string[] {
    const missing: string[] = [];
    if (!this.getServiceUrl()) missing.push('ESSL_WEB_API_URL');
    if (!this.getSerial()) missing.push('ESSL_SERIAL_NUMBER');
    if (!this.getUser()) missing.push('ESSL_API_USERNAME');
    if (!this.getPassword()) missing.push('ESSL_API_PASSWORD');
    return missing;
  }

  /** Public host from URL for status responses (no path/credentials). */
  getConfiguredUrlHost(): string | null {
    const raw = this.getServiceUrl();
    if (!raw) return null;
    try {
      return new URL(raw).host;
    } catch {
      return null;
    }
  }

  /**
   * Whether **this Node process** can open the ASMX page (GET). If false, SOAP sync will not work.
   * On the gym LAN, try `http://192.168.1.5:82/...` when the public IP fails (NAT / hairpin).
   */
  async checkAsmxHttpReachable(): Promise<{
    ok: boolean;
    status?: number;
    detail: string;
  }> {
    const raw = this.getServiceUrl();
    if (!raw) {
      return { ok: false, detail: 'ESSL_WEB_API_URL is not set' };
    }
    let base: string;
    try {
      const u = new URL(raw.split('?')[0]);
      base = u.origin + u.pathname.split('?')[0];
    } catch (e) {
      return { ok: false, detail: `Invalid URL: ${e instanceof Error ? e.message : String(e)}` };
    }
    try {
      const res = await axios.get<string>(base, {
        timeout: 10_000,
        validateStatus: (s) => s >= 200 && s < 600,
        responseType: 'text',
        headers: { Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
      });
      if (res.status >= 200 && res.status < 500) {
        return { ok: true, status: res.status, detail: `GET ${base} → HTTP ${res.status}` };
      }
      return { ok: false, status: res.status, detail: `GET ${base} → HTTP ${res.status}` };
    } catch (e) {
      const err = e as AxiosError;
      const msg = err.message || 'request failed';
      this.logger.warn(`eSSL ASMX reachability check failed: ${msg}`);
      return { ok: false, detail: msg };
    }
  }

  private getServiceUrl(): string | undefined {
    const url = this.configService.get<string>('ESSL_WEB_API_URL')?.trim();
    return url || undefined;
  }

  /**
   * POST target URL. eSSL/Postman examples use `?op=GetTransactionsLog` on the .asmx path;
   * without it, some IIS hosts return 200 with an empty or stub body (~400B).
   * If the URL already has a query, it is left unchanged. Set ESSL_SOAP_NO_OP_QUERY=1 to skip.
   */
  getServiceUrlForSoapPost(): string {
    const url = this.getServiceUrl();
    if (!url) {
      throw new Error('ESSL_WEB_API_URL is not set');
    }
    if (url.includes('?')) {
      return url;
    }
    const skip =
      this.configService.get<string>('ESSL_SOAP_NO_OP_QUERY')?.trim() === '1' ||
      this.configService
        .get<string>('ESSL_SOAP_NO_OP_QUERY')
        ?.trim()
        .toLowerCase() === 'true';
    if (skip) {
      return url;
    }
    return `${url}?op=GetTransactionsLog`;
  }

  private getSerial(): string {
    return this.configService.get<string>('ESSL_SERIAL_NUMBER')?.trim() || '';
  }

  private getUser(): string {
    return this.configService.get<string>('ESSL_API_USERNAME')?.trim() || '';
  }

  private getPassword(): string {
    return this.configService.get<string>('ESSL_API_PASSWORD')?.trim() || '';
  }

  /** Often a filter flag; default matches common demo usage */
  private getStrDataList(): string {
    return (
      this.configService.get<string>('ESSL_STR_DATA_LIST')?.trim() ?? '4'
    );
  }

  /**
   * - date: &lt;FromDate&gt; / &lt;ToDate&gt; only
   * - datetime: &lt;FromDateTime&gt; / &lt;ToDateTime&gt; only
   * - both: all four (some IIS hosts ignore &lt;FromDate&gt; unless &lt;FromDateTime&gt; is set)
   * Unset: same as "datetime"
   */
  private getSoapDateMode(): 'date' | 'datetime' | 'both' {
    const v =
      this.configService.get<string>('ESSL_SOAP_DATE_FIELDS')?.trim().toLowerCase() ??
      '';
    if (v === 'date' || v === 'fromdate') return 'date';
    if (v === 'both') return 'both';
    return 'datetime';
  }

  /**
   * Calendar date of instant in APP_TIMEZONE (avoids using server machine TZ, which
   * breaks SOAP when Nest runs in UTC and the gym uses Asia/Kolkata).
   */
  private formatDateOnly(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: this.getAppTimeZone() });
  }

  /**
   * Format datetime as eSSL often expects: "2025-5-1 00:01" (unpadded month/day ok),
   * using wall clock in APP_TIMEZONE.
   */
  private formatDateTime(d: Date): string {
    const tz = this.getAppTimeZone();
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const p = f.formatToParts(d);
    const g = (t: Intl.DateTimeFormatPartTypes) =>
      p.find((x) => x.type === t)?.value ?? '0';
    const y = g('year');
    const m = String(Number(g('month')));
    const day = String(Number(g('day')));
    const hh = g('hour').padStart(2, '0');
    const mm = g('minute').padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }

  /**
   * Some eTimeTrack builds reject plain YYYY-MM-DD in &lt;FromDate&gt;/&lt;ToDate&gt; and require
   * `yyyy-MM-dd HH:mm:ss` (error: "not valid date format(yyyy-MM-dd HH:mm)").
   * Set ESSL_SOAP_DATE_PLAIN=1 to send date-only (Postman-style) if your server needs it.
   */
  private fromToDateStringForSoap(fromYmd: string, toYmd: string): {
    from: string;
    to: string;
  } {
    const plain =
      this.configService.get<string>('ESSL_SOAP_DATE_PLAIN')?.trim() === '1' ||
      this.configService
        .get<string>('ESSL_SOAP_DATE_PLAIN')
        ?.trim()
        .toLowerCase() === 'true';
    if (plain) {
      return { from: fromYmd, to: toYmd };
    }
    return { from: `${fromYmd} 00:00:00`, to: `${toYmd} 23:59:59` };
  }

  /**
   * eSSL / Postman samples use calendar strings like &lt;FromDate&gt;2022-8-1&lt;/FromDate&gt; and
   * &lt;ToDate&gt;2022-9-30&lt;/ToDate&gt; — **no** time part, and day 1-9 is a single digit.
   * (Canonical input is YYYY-MM-DD from the CRM.)
   */
  private isPostmanFromToDateStyle(): boolean {
    return (
      this.configService.get<string>('ESSL_SOAP_DATE_STYLE')?.trim().toLowerCase() ===
      'postman'
    );
  }

  private formatYmdToPostmanFromTo(ymd: string): string {
    const p = ymd.split('-');
    if (p.length !== 3) return ymd;
    const y = p[0];
    const m = parseInt(p[1], 10);
    const d = parseInt(p[2], 10);
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return ymd;
    const mm = String(m).padStart(2, '0');
    const dd = d < 10 ? String(d) : String(d).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }

  /**
   * Canonical calendar range (YMD in app TZ) and exact strings we put in &lt;FromDate&gt;&lt;ToDate&gt;
   * (or combined with &lt;FromDateTime&gt; when mode is not date-only).
   */
  /** What we log and what goes into &lt;FromDate&gt;/&lt;ToDate&gt; (and time fields when not date-only). */
  private getSoapDateParts(
    from: Date,
    to: Date,
    opts?: { fromYmd?: string; toYmd?: string },
  ): {
    fromYmd: string;
    toYmd: string;
    fromForSoap: string;
    toForSoap: string;
    mode: 'date' | 'datetime' | 'both';
    isPostman: boolean;
  } {
    const fromYmd =
      opts?.fromYmd && this.isYmd(opts.fromYmd) ? opts.fromYmd : this.formatDateOnly(from);
    const toYmd =
      opts?.toYmd && this.isYmd(opts.toYmd) ? opts.toYmd : this.formatDateOnly(to);
    const isPostman = this.isPostmanFromToDateStyle();
    let fromForSoap: string;
    let toForSoap: string;
    if (isPostman) {
      fromForSoap = this.formatYmdToPostmanFromTo(fromYmd);
      toForSoap = this.formatYmdToPostmanFromTo(toYmd);
    } else {
      const x = this.fromToDateStringForSoap(fromYmd, toYmd);
      fromForSoap = x.from;
      toForSoap = x.to;
    }
    const mode = isPostman ? 'date' : this.getSoapDateMode();
    return { fromYmd, toYmd, fromForSoap, toForSoap, mode, isPostman };
  }

  buildSoapEnvelope(
    from: Date,
    to: Date,
    opts?: { fromYmd?: string; toYmd?: string },
    cached?: ReturnType<EsslWebApiService['getSoapDateParts']>,
  ): string {
    const serial = this.getSerial();
    const user = this.getUser();
    const pass = this.getPassword();
    const strList = this.getStrDataList();
    const { fromForSoap, toForSoap, mode } =
      cached ?? this.getSoapDateParts(from, to, opts);
    const fdt = this.formatDateTime(from);
    const tdt = this.formatDateTime(to);
    const dateOnlyBlock = `      <FromDate>${this.escapeXml(fromForSoap)}</FromDate>
      <ToDate>${this.escapeXml(toForSoap)}</ToDate>`;
    const timeOnlyBlock = `      <FromDateTime>${this.escapeXml(fdt)}</FromDateTime>
      <ToDateTime>${this.escapeXml(tdt)}</ToDateTime>`;
    const dateSection =
      mode === 'date'
        ? dateOnlyBlock
        : mode === 'both'
          ? `${dateOnlyBlock}\n${timeOnlyBlock}`
          : timeOnlyBlock;
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetTransactionsLog xmlns="http://tempuri.org/">
${dateSection}
      <SerialNumber>${this.escapeXml(serial)}</SerialNumber>
      <UserName>${this.escapeXml(user)}</UserName>
      <UserPassword>${this.escapeXml(pass)}</UserPassword>
      <strDataList>${this.escapeXml(strList)}</strDataList>
    </GetTransactionsLog>
  </soap:Body>
</soap:Envelope>`;
  }

  private isYmd(s: string | undefined): s is string {
    return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * POST SOAP and return raw XML response body
   */
  async fetchTransactionsLogXml(
    from: Date,
    to: Date,
    ymd?: { fromYmd?: string; toYmd?: string },
    ctx?: { funnelId?: string },
  ): Promise<string> {
    const url = this.getServiceUrlForSoapPost();
    const f = ctx?.funnelId ? ` [Funnel ${ctx.funnelId}]` : '';
    const parts = this.getSoapDateParts(from, to, ymd);
    const body = this.buildSoapEnvelope(from, to, ymd, parts);
    const modeLabel = parts.isPostman
      ? `postman (FromDate/ToDate only) = ${parts.fromForSoap} … ${parts.toForSoap} (day 1–9 unpadded, no 00:00:00)`
      : `${parts.mode} (FromDate/ToDate) = ${parts.fromForSoap} … ${parts.toForSoap}`;
    this.logger.log(
      `${f} SOAP GetTransactionsLog → ${url} · ${modeLabel} ` +
        `· calendar ${parts.fromYmd}…${parts.toYmd}`,
    );

    try {
      const res = await axios.post<string>(url, body, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: 'http://tempuri.org/GetTransactionsLog',
        },
        timeout: 120_000,
        responseType: 'text',
        // allow HTTP to local biometric server
        validateStatus: (s) => s >= 200 && s < 600,
      });

      if (res.status >= 400) {
        this.logger.warn(
          `${f} SOAP response HTTP ${res.status} (body ${String(res.data).length} chars)`,
        );
        throw new Error(`HTTP ${res.status}: ${String(res.data).slice(0, 500)}`);
      }
      const xml = typeof res.data === 'string' ? res.data : String(res.data);
      const fault = this.extractSoapFault(xml);
      if (fault) {
        this.logger.warn(`${f} SOAP body contained fault: ${fault.slice(0, 200)}`);
        throw new Error(`SOAP fault: ${fault}`);
      }
      const resultErr = this.extractGetTransactionsLogResultError(xml);
      if (resultErr) {
        this.logger.warn(`${f} eSSL GetTransactionsLogResult: ${resultErr.slice(0, 300)}`);
        throw new Error(`eSSL GetTransactionsLog: ${resultErr}`);
      }
      this.logger.log(
        `${f} SOAP OK — HTTP ${res.status}, response ${xml.length} bytes`,
      );
      return xml;
    } catch (e) {
      const err = e as AxiosError;
      const msg =
        err.response?.data != null
          ? String(err.response.data).slice(0, 800)
          : err.message;
      if (/unatho?ri[sz]ed|unauthori[sz]ed/i.test(String(msg))) {
        this.logger.error(
          `${f} eSSL Web API: Unauthorised (server rejected SOAP). UserName in request: ` +
            `${this.getUser() ? `"${this.getUser()}"` : '(empty — set ESSL_API_USERNAME)'} ` +
            `· URL: ${url}`,
        );
      }
      this.logger.error(`${f} SOAP request failed: ${msg}`);
      throw new Error(`eSSL Web API request failed: ${msg}`);
    }
  }

  /** Parse SOAP 1.1/1.2 fault text from response body (HTTP may still be 200). */
  extractSoapFault(xml: string): string | null {
    const decoded = xml
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const faultString =
      decoded.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i) ||
      decoded.match(/<soap:Text[^>]*>([\s\S]*?)<\/soap:Text>/i);
    if (faultString?.[1]) {
      return faultString[1].replace(/<[^>]+>/g, '').trim();
    }
    if (/<faultcode/i.test(decoded) && /<faultstring/i.test(decoded)) {
      return 'SOAP fault (see server logs for raw XML)';
    }
    return null;
  }

  /**
   * 200 OK can still return &lt;GetTransactionsLogResult&gt;FromDate... not valid...&lt;/&gt; — no logs.
   */
  extractGetTransactionsLogResultError(xml: string): string | null {
    const m = xml.match(
      /<GetTransactionsLogResult[^>]*>([\s\S]*?)<\/GetTransactionsLogResult>/i,
    );
    if (!m?.[1]) return null;
    const t = m[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return null;
    if (/^logs\s*count\s*:/i.test(t)) return null;
    if (/(not valid|is not valid|invalid date|invalid|format\s*\(yyyy|error|exception|failed|denied|wrong password|unathor|unauthor)/i.test(t)) {
      return t;
    }
    return null;
  }

  /** Short, single-line preview for admin troubleshooting (response body; no secrets expected). */
  previewResponseXml(xml: string, max = 600): string {
    return xml.replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /**
   * When 0 lines were parsed, explain what the SOAP body said (e.g. "Logs count: 0")
   * and include a safe preview. Call before relying on the UI.
   */
  summarizeZeroLineResponse(xml: string, maxPreview = 800): string {
    const flat = xml.replace(/\s+/g, ' ').trim();
    const countMatch = flat.match(/Logs\s*Count\s*:\s*(\d+)/i);
    const parts: string[] = [];
    if (countMatch) {
      parts.push(
        `eSSL text says "Logs count: ${countMatch[1]}". ` +
          (countMatch[1] === '0'
            ? 'The server has no log rows for this SerialNumber + strDataList + date window (or wrong serial/list).'
            : 'If count > 0 but we parsed 0 lines, the result format may differ from expected — see preview.'),
      );
    } else {
      parts.push(
        'No "Logs count:N" in body — strDataList/result may be empty or use another schema. See preview.',
      );
    }
    parts.push(`raw ${xml.length} B → ${this.previewResponseXml(xml, maxPreview)}`);
    return parts.join(' ');
  }

  /**
   * Extract transaction lines from SOAP XML.
   * Typical line: "1 2022-08-24 17:45:40 in" (device user id, date, time, optional in/out)
   */
  extractTransactionLines(xml: string): string[] {
    let decoded = xml
      .replace(/&#x0?D;/gi, '\n')
      .replace(/&#x0?A;/gi, '\n')
      .replace(/&#13;/g, '\n')
      .replace(/&#10;/g, '\n')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&#32;/g, ' ');

    let blob = '';
    const mStr =
      decoded.match(/<strDataList[^>]*>([\s\S]*?)<\/strDataList>/i) ||
      decoded.match(
        /<[^>]*:strDataList[^>]*>([\s\S]*?)<\/[^>]*:strDataList>/i,
      );
    const mRes = decoded.match(
      /<GetTransactionsLogResult[^>]*>([\s\S]*?)<\/GetTransactionsLogResult>/i,
    );
    if (mStr?.[1]) {
      blob = mStr[1];
    } else if (mRes?.[1]) {
      blob = mRes[1];
    }
    for (const m of decoded.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/gi)) {
      blob += ` ${m[1]}`;
    }
    for (const m of decoded.matchAll(
      /<string[^>]*>([^<]+)<\/string>/gi,
    )) {
      blob += ` ${m[1]}`;
    }
    if (!blob.trim()) {
      blob = decoded;
    }

    // Remove XML-ish noise inside blob
    blob = blob.replace(/<[^>]+>/g, ' ');
    blob = blob.replace(/\r/g, ' ').replace(/\t/g, ' ');
    // Drop "Logs Count:N" prefix text
    blob = blob.replace(/Logs\s*Count\s*:\s*\d+/gi, ' ');

    const lines: string[] = [];
    const seen = new Set<string>();

    const tryRecord = (
      userId: string,
      ymd: string,
      hms: string,
      io?: string,
    ) => {
      const norm = `${userId} ${ymd} ${hms}${io ? ` ${io}` : ''}`;
      if (seen.has(norm)) return;
      seen.add(norm);
      lines.push(norm.trim());
    };

    // YYYY-MM-DD + flexible time + optional in/out
    const re1 =
      /(\d+)\s+(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{1,2}:\d{1,2})(?:\s+(in|out|In|Out))?/g;
    let m: RegExpExecArray | null;
    while ((m = re1.exec(blob)) !== null) {
      const ymd = this.normalizeYmd(m[2]);
      if (!ymd) continue;
      const hms = this.normalizeHms(m[3]);
      tryRecord(m[1], ymd, hms, m[4]);
    }

    // DD-MM-YYYY or DD/MM/YYYY (day, month, year) — same order as the portal "Log date" (e.g. 24-04-2026)
    const re2 =
      /(\d+)\s+(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s+(\d{1,2}:\d{1,2}:\d{1,2})(?:\s+(in|out|In|Out))?/g;
    while ((m = re2.exec(blob)) !== null) {
      const ymd = `${m[4]}-${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      tryRecord(m[1], ymd, this.normalizeHms(m[5]), m[6]);
    }

    // Comma-separated (some SOAP dumps use CSV-style tokens)
    const re3a =
      /(\d+),\s*(\d{4}-\d{1,2}-\d{1,2}),\s*(\d{1,2}:\d{1,2}:\d{1,2})/g;
    while ((m = re3a.exec(blob)) !== null) {
      const ymd = this.normalizeYmd(m[2]);
      if (!ymd) continue;
      tryRecord(m[1], ymd, this.normalizeHms(m[3]), undefined);
    }
    const re3b =
      /(\d+),\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{4}),\s*(\d{1,2}:\d{1,2}:\d{1,2})/g;
    while ((m = re3b.exec(blob)) !== null) {
      const ymd = `${m[4]}-${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      tryRecord(m[1], ymd, this.normalizeHms(m[5]), undefined);
    }

    // eTimeTrack Device Log: "1  24 Apr 2026 21:04:45" or "1	24 Apr 2026 21:04:45"
    const re4 =
      /(\d+)\s+(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{4})\s+(\d{1,2}:\d{1,2}:\d{1,2})(?:\s+(in|out|In|Out))?/g;
    while ((m = re4.exec(blob)) !== null) {
      const mo = this.monthNameToM(m[3]);
      if (!mo) continue;
      const ymd = `${m[4]}-${mo}-${m[2].padStart(2, '0')}`;
      tryRecord(m[1], ymd, this.normalizeHms(m[5]), m[6]);
    }

    if (lines.length === 0 && blob.length > 20) {
      this.logger.warn(
        `eSSL: 0 log lines parsed. Response snippet: ${blob.replace(/\s+/g, ' ').slice(0, 500)}…`,
      );
    }
    return lines;
  }

  private normalizeYmd(ymd: string): string | null {
    const p = ymd.split('-');
    if (p.length !== 3) return null;
    return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
  }

  private normalizeHms(t: string): string {
    const p = t.split(':');
    if (p.length < 3) return t;
    return `${p[0].padStart(2, '0')}:${p[1].padStart(2, '0')}:${p[2].padStart(2, '0')}`;
  }

  /** eTimeTrack portal often shows "24 Apr 2026" / "24 April 2026" in Device Log list; SOAP can match. */
  private monthNameToM(m: string): string | null {
    const s = m.trim().toLowerCase();
    if (s.length < 3) return null;
    const key = s.slice(0, 3);
    const mon: Record<string, string> = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
    };
    return mon[key] ?? null;
  }

  /**
   * Parse one line into device user id + punch datetime
   */
  parseLine(line: string): { userId: string; dateTime: string } | null {
    const s = line.trim();
    const re1 =
      /^(\d+)\s+(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{1,2}:\d{1,2})/;
    const a = s.match(re1);
    if (a) {
      const ymd = this.normalizeYmd(a[2])!;
      const hms = this.normalizeHms(a[3]);
      return { userId: a[1], dateTime: `${ymd} ${hms}` };
    }
    const re2 =
      /^(\d+)\s+(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s+(\d{1,2}:\d{1,2}:\d{1,2})/;
    const b = s.match(re2);
    if (b) {
      const ymd = `${b[4]}-${b[3].padStart(2, '0')}-${b[2].padStart(2, '0')}`;
      return {
        userId: b[1],
        dateTime: `${ymd} ${this.normalizeHms(b[5])}`,
      };
    }
    const re3a =
      /^(\d+),\s*(\d{4}-\d{1,2}-\d{1,2}),\s*(\d{1,2}:\d{1,2}:\d{1,2})/;
    const c = s.match(re3a);
    if (c) {
      const ymd = this.normalizeYmd(c[2]);
      if (ymd) {
        return { userId: c[1], dateTime: `${ymd} ${this.normalizeHms(c[3])}` };
      }
    }
    const re3b =
      /^(\d+),\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{4}),\s*(\d{1,2}:\d{1,2}:\d{1,2})/;
    const d = s.match(re3b);
    if (d) {
      const ymd = `${d[4]}-${d[3].padStart(2, '0')}-${d[2].padStart(2, '0')}`;
      return { userId: d[1], dateTime: `${ymd} ${this.normalizeHms(d[5])}` };
    }
    const re4 =
      /^(\d+)\s+(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{4})\s+(\d{1,2}:\d{1,2}:\d{1,2})/;
    const e = s.match(re4);
    if (e) {
      const mo = this.monthNameToM(e[3]);
      if (mo) {
        const ymd = `${e[4]}-${mo}-${e[2].padStart(2, '0')}`;
        return { userId: e[1], dateTime: `${ymd} ${this.normalizeHms(e[5])}` };
      }
    }
    return null;
  }
}
