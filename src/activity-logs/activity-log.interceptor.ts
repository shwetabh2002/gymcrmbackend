import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { ActivityLogsService } from './activity-logs.service';
import { isActivityLogsEnabled } from '../config/activity-logs.config';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Paths we never audit (auth noise, self-reads, health). */
const SKIP_PREFIXES = [
  '/auth/',
  '/activity-logs',
  '/platform/activity',
  '/webhooks/',
  '/health',
];

const REDACT_KEYS = new Set([
  'password',
  'adminpassword',
  'currentpassword',
  'newpassword',
  'keysecret',
  'accessToken',
  'accesstoken',
  'refreshtoken',
  'refreshToken',
  'cloudtoken',
  'webhooksecret',
  'token',
  'secret',
]);

function shouldSkip(path: string): boolean {
  const p = (path || '').split('?')[0].toLowerCase();
  return SKIP_PREFIXES.some((s) => p === s || p.startsWith(s));
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 3 || value == null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k.toLowerCase())) {
        out[k] = '[redacted]';
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 500)}…`;
  }
  return value;
}

function verbFor(method: string): string {
  switch (method) {
    case 'POST':
      return 'created/submitted';
    case 'PUT':
    case 'PATCH':
      return 'updated';
    case 'DELETE':
      return 'deleted';
    default:
      return method.toLowerCase();
  }
}

function resolveCompanyId(req: any): string | null {
  // Prefer route/body target over active-gym switcher — otherwise SUPER_ADMIN
  // actions on gym B while viewing gym A would audit under A.
  if (req.params?.companyId) return String(req.params.companyId);
  if (req.body?.companyId && typeof req.body.companyId === 'string') {
    return req.body.companyId;
  }
  if (req.user?.companyId) return String(req.user.companyId);
  return null;
}

/**
 * When ACTIVITY_LOGS_ENABLED=true, every mutating API call is written with
 * who (name/email/role) + what (method/path) + outcome. Domain services may
 * still add richer summaries on top.
 */
@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  constructor(private readonly activityLogs: ActivityLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!isActivityLogsEnabled()) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const method = String(req.method || '').toUpperCase();
    if (!MUTATING.has(method)) return next.handle();

    const path = String(req.originalUrl || req.url || '');
    if (shouldSkip(path)) return next.handle();

    const user = req.user;
    const companyId = resolveCompanyId(req);
    if (!companyId || !user?.userId) return next.handle();

    const started = Date.now();
    const cleanPath = path.split('?')[0];

    return next.handle().pipe(
      tap({
        next: () => {
          const code = Number(res?.statusCode) || 200;
          void this.write(req, companyId, method, cleanPath, code, started);
        },
        error: (err) => {
          const code = Number(err?.status || err?.statusCode || 500);
          void this.write(req, companyId, method, cleanPath, code, started);
        },
      }),
    );
  }

  private async write(
    req: any,
    companyId: string,
    method: string,
    path: string,
    statusCode: number,
    started: number,
  ) {
    const user = req.user;
    const name = user.name || user.email || 'User';
    const resource = path.replace(/^\//, '').split('/').slice(0, 3).join('/');
    const ok = statusCode < 400;

    await this.activityLogs.log({
      companyId,
      locationId: user.locationId || null,
      actor: {
        userId: user.userId,
        name,
        email: user.email || null,
        role: user.role || null,
      },
      action: `HTTP_${method}`,
      entityType: 'http_request',
      entityId: req.params?.id ? String(req.params.id) : null,
      summary: ok
        ? `${name} ${verbFor(method)} ${resource}`
        : `${name} failed ${method} ${resource} (${statusCode})`,
      httpMethod: method,
      httpPath: path,
      statusCode,
      metadata: {
        query: redact(req.query || {}),
        body: redact(req.body || {}),
        durationMs: Date.now() - started,
        role: user.role,
      },
    });
  }
}
