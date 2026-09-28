import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ActivityLog,
  ActivityLogDocument,
} from './schemas/activity-log.schema';
import {
  DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
  MAX_ACTIVITY_LOG_RETENTION_DAYS,
  MIN_ACTIVITY_LOG_RETENTION_DAYS,
  isActivityLogsEnabled,
} from '../config/activity-logs.config';
import {
  GymSettings,
  GymSettingsDocument,
} from '../gym-settings/schemas/gym-settings.schema';
import {
  PlatformSubscription,
  PlatformSubscriptionDocument,
} from '../platform-billing/schemas/platform-subscription.schema';
import {
  PlatformPlan,
  PlatformPlanDocument,
} from '../platform-billing/schemas/platform-plan.schema';
import { DAY_MS } from '../config/time.constants';
import { JobLockService } from '../common/locks/job-lock.service';

const ACTIVITY_PURGE_LOCK_KEY = 'activity-log-purge';

export type ActivityActor = {
  userId?: string | null;
  name: string;
  email?: string | null;
  role?: string | null;
};

export type LogActivityInput = {
  companyId: string;
  locationId?: string | null;
  actor: ActivityActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  httpMethod?: string | null;
  httpPath?: string | null;
  statusCode?: number | null;
};

export const SYSTEM_ACTOR: ActivityActor = {
  userId: null,
  name: 'System',
  email: null,
  role: 'SYSTEM',
};

export type ActivityAccess = {
  /**
   * Logs actually write/read: backend master ON + gym entitled + gym switch ON.
   */
  available: boolean;
  /** Layer 1 — env ACTIVITY_LOGS_ENABLED. */
  globallyEnabled: boolean;
  /** Layer 2 entitlement — SUPER_ADMIN unlock for this gym. */
  featureUnlocked: boolean;
  /** Layer 2 entitlement — this gym's plan includes ACTIVITY_LOGS. */
  planIncludes: boolean;
  /** Entitled = unlock OR plan. */
  entitled: boolean;
  /** Layer 2 dynamic switch — per-gym on/off. */
  gymEnabled: boolean;
  retentionDays: number;
};

const ACCESS_CACHE_TTL_MS = 60_000;

@Injectable()
export class ActivityLogsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActivityLogsService.name);
  private accessCache = new Map<
    string,
    { at: number; value: ActivityAccess }
  >();
  private purgeTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(ActivityLog.name)
    private activityLogModel: Model<ActivityLogDocument>,
    @InjectModel(GymSettings.name)
    private gymSettingsModel: Model<GymSettingsDocument>,
    @InjectModel(PlatformSubscription.name)
    private subModel: Model<PlatformSubscriptionDocument>,
    @InjectModel(PlatformPlan.name)
    private planModel: Model<PlatformPlanDocument>,
    private jobLock: JobLockService,
  ) {}

  onModuleInit() {
    if (!isActivityLogsEnabled()) {
      this.logger.log('Activity log purge skipped — ACTIVITY_LOGS_ENABLED off');
      return;
    }
    // Daily-ish purge of expired rows (every 6h).
    this.purgeTimer = setInterval(
      () => {
        void this.purgeExpired().catch((err) =>
          this.logger.warn(`Activity log purge failed: ${err?.message}`),
        );
      },
      6 * 60 * 60 * 1000,
    );
    if (typeof this.purgeTimer.unref === 'function') this.purgeTimer.unref();
  }

  onModuleDestroy() {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    this.purgeTimer = null;
  }

  isEnabled(): boolean {
    return isActivityLogsEnabled();
  }

  invalidateAccessCache(companyId?: string) {
    if (companyId) this.accessCache.delete(companyId);
    else this.accessCache.clear();
  }

  /** Drop expired entries so the Map cannot grow forever with abandoned gyms. */
  private pruneAccessCache() {
    const now = Date.now();
    for (const [k, v] of this.accessCache) {
      if (now - v.at >= ACCESS_CACHE_TTL_MS) this.accessCache.delete(k);
    }
  }

  async getAccess(companyId: string): Promise<ActivityAccess> {
    const globallyEnabled = isActivityLogsEnabled();
    if (!globallyEnabled) {
      return {
        available: false,
        globallyEnabled: false,
        featureUnlocked: false,
        planIncludes: false,
        entitled: false,
        gymEnabled: false,
        retentionDays: DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
      };
    }

    if (this.accessCache.size > 200) this.pruneAccessCache();

    const cached = this.accessCache.get(companyId);
    if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) {
      return cached.value;
    }

    const cid = new Types.ObjectId(companyId);
    const [settings, sub] = await Promise.all([
      this.gymSettingsModel
        .findOne({ companyId: cid })
        .select(
          'featureActivityLogsUnlocked activityLogsEnabled activityLogRetentionDays',
        )
        .lean()
        .exec(),
      this.subModel.findOne({ companyId: cid }).select('planId').lean().exec(),
    ]);

    let planIncludes = false;
    if (sub?.planId) {
      const plan = await this.planModel
        .findById(sub.planId)
        .select('features')
        .lean()
        .exec();
      planIncludes = ((plan as any)?.features || []).includes('ACTIVITY_LOGS');
    }

    const featureUnlocked = settings?.featureActivityLogsUnlocked === true;
    const entitled = featureUnlocked || planIncludes;
    const gymEnabled = settings?.activityLogsEnabled === true;
    // Backend master + this gym entitled + this gym switch ON.
    const available = entitled && gymEnabled;

    let retentionDays =
      typeof settings?.activityLogRetentionDays === 'number'
        ? settings.activityLogRetentionDays
        : DEFAULT_ACTIVITY_LOG_RETENTION_DAYS;
    retentionDays = Math.min(
      MAX_ACTIVITY_LOG_RETENTION_DAYS,
      Math.max(MIN_ACTIVITY_LOG_RETENTION_DAYS, retentionDays),
    );

    const value: ActivityAccess = {
      available,
      globallyEnabled: true,
      featureUnlocked,
      planIncludes,
      entitled,
      gymEnabled,
      retentionDays,
    };
    this.accessCache.set(companyId, { at: Date.now(), value });
    return value;
  }

  async log(input: LogActivityInput) {
    if (!isActivityLogsEnabled()) return null;
    try {
      if (!input.companyId) return null;
      const access = await this.getAccess(input.companyId);
      if (!access.available) return null;

      const actorId =
        input.actor?.userId && Types.ObjectId.isValid(input.actor.userId)
          ? new Types.ObjectId(input.actor.userId)
          : null;

      return await this.activityLogModel.create({
        companyId: new Types.ObjectId(input.companyId),
        locationId: input.locationId
          ? new Types.ObjectId(input.locationId)
          : null,
        actorId,
        actorName: input.actor?.name || 'Unknown',
        actorEmail: input.actor?.email ?? null,
        actorRole: input.actor?.role ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        httpMethod: input.httpMethod ?? null,
        httpPath: input.httpPath ?? null,
        statusCode: input.statusCode ?? null,
        metadata: input.metadata ?? {},
      });
    } catch (err: any) {
      this.logger.warn(`Failed to write activity log: ${err?.message}`);
      return null;
    }
  }

  async findRecent(
    companyId: string,
    limit = 25,
    locScope: { locationId?: string } = {},
  ) {
    const access = await this.getAccess(companyId);
    if (!access.available) return [];
    const since = new Date(Date.now() - access.retentionDays * DAY_MS);
    return this.activityLogModel
      .find({ companyId, createdAt: { $gte: since }, ...locScope })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  /** Gym staff feed — paginated, optional text filter, retention-bounded. */
  async listForCompany(opts: {
    companyId: string;
    q?: string;
    action?: string;
    limit?: number;
    skip?: number;
  }) {
    const access = await this.getAccess(opts.companyId);
    if (!access.globallyEnabled) {
      return {
        enabled: false,
        available: false,
        featureUnlocked: false,
        planIncludes: false,
        entitled: false,
        gymEnabled: false,
        retentionDays: access.retentionDays,
        total: 0,
        items: [] as any[],
      };
    }
    if (!access.available) {
      return {
        enabled: true,
        available: false,
        featureUnlocked: access.featureUnlocked,
        planIncludes: access.planIncludes,
        entitled: access.entitled,
        gymEnabled: access.gymEnabled,
        retentionDays: access.retentionDays,
        total: 0,
        items: [] as any[],
      };
    }

    const since = new Date(Date.now() - access.retentionDays * DAY_MS);
    const filter: Record<string, unknown> = {
      companyId: new Types.ObjectId(opts.companyId),
      createdAt: { $gte: since },
    };
    if (opts.action?.trim()) {
      filter.action = opts.action.trim().toUpperCase();
    }
    const term = (opts.q || '').trim();
    if (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [
        { summary: rx },
        { actorName: rx },
        { actorEmail: rx },
        { action: rx },
        { entityType: rx },
        { httpPath: rx },
      ];
    }
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.skip ?? 0, 0);
    const [total, rows] = await Promise.all([
      this.activityLogModel.countDocuments(filter).exec(),
      this.activityLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
    ]);
    return {
      enabled: true,
      available: true,
      featureUnlocked: access.featureUnlocked,
      planIncludes: access.planIncludes,
      entitled: access.entitled,
      gymEnabled: access.gymEnabled,
      retentionDays: access.retentionDays,
      total,
      items: rows.map((r) => this.toClient(r)),
    };
  }

  /**
   * SUPER_ADMIN view for one gym only — never cross-tenant.
   * companyId is required (active gym in the switcher).
   */
  async findPlatformRecent(opts: {
    companyId?: string | null;
    q?: string;
    limit?: number;
  }) {
    if (!opts.companyId) {
      return {
        enabled: isActivityLogsEnabled(),
        available: false,
        featureUnlocked: false,
        planIncludes: false,
        entitled: false,
        gymEnabled: false,
        retentionDays: DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
        companyId: null as string | null,
        items: [] as any[],
        needsGym: true,
      };
    }

    const access = await this.getAccess(opts.companyId);
    if (!access.globallyEnabled) {
      return {
        enabled: false,
        available: false,
        featureUnlocked: false,
        planIncludes: false,
        entitled: false,
        gymEnabled: false,
        retentionDays: access.retentionDays,
        companyId: opts.companyId,
        items: [] as any[],
      };
    }
    if (!access.available) {
      return {
        enabled: true,
        available: false,
        featureUnlocked: access.featureUnlocked,
        planIncludes: access.planIncludes,
        entitled: access.entitled,
        gymEnabled: access.gymEnabled,
        retentionDays: access.retentionDays,
        companyId: opts.companyId,
        items: [] as any[],
      };
    }

    return {
      ...(await this.listForCompany({
        companyId: opts.companyId,
        q: opts.q,
        limit: opts.limit ?? 50,
      })),
      companyId: opts.companyId,
    };
  }

  /** Drop rows older than each gym's retention window. */
  async purgeExpired() {
    if (!isActivityLogsEnabled()) return { deleted: 0 };

    const result = await this.jobLock.runExclusively(
      ACTIVITY_PURGE_LOCK_KEY,
      () => this.runPurge(),
    );
    return result ?? { deleted: 0, alreadyRunning: true };
  }

  private async runPurge() {
    const settings = await this.gymSettingsModel
      .find({
        $or: [
          { featureActivityLogsUnlocked: true },
          { activityLogsEnabled: true },
          { activityLogRetentionDays: { $exists: true } },
        ],
      })
      .select('companyId activityLogRetentionDays featureActivityLogsUnlocked')
      .lean()
      .exec();

    let deleted = 0;
    for (const s of settings as any[]) {
      const days = Math.min(
        MAX_ACTIVITY_LOG_RETENTION_DAYS,
        Math.max(
          MIN_ACTIVITY_LOG_RETENTION_DAYS,
          typeof s.activityLogRetentionDays === 'number'
            ? s.activityLogRetentionDays
            : DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
        ),
      );
      const cutoff = new Date(Date.now() - days * DAY_MS);
      const res = await this.activityLogModel
        .deleteMany({
          companyId: s.companyId,
          createdAt: { $lt: cutoff },
        })
        .exec();
      deleted += res.deletedCount || 0;
    }

    // Also purge orphan logs past max retention for companies without settings.
    const maxCutoff = new Date(
      Date.now() - MAX_ACTIVITY_LOG_RETENTION_DAYS * DAY_MS,
    );
    const orphan = await this.activityLogModel
      .deleteMany({ createdAt: { $lt: maxCutoff } })
      .exec();
    deleted += orphan.deletedCount || 0;

    if (deleted > 0) {
      this.logger.log(`Purged ${deleted} expired activity log row(s)`);
    }
    return { deleted };
  }

  private toClient(r: any) {
    return {
      id: String(r._id),
      companyId: String(r.companyId),
      locationId: r.locationId ? String(r.locationId) : null,
      actorId: r.actorId ? String(r.actorId) : null,
      actorName: r.actorName,
      actorEmail: r.actorEmail ?? null,
      actorRole: r.actorRole ?? null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId ?? null,
      summary: r.summary,
      httpMethod: r.httpMethod ?? null,
      httpPath: r.httpPath ?? null,
      statusCode: r.statusCode ?? null,
      metadata: r.metadata ?? {},
      createdAt: r.createdAt,
    };
  }
}
