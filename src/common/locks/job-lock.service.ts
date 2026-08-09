import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { hostname } from 'os';
import { JobLock, JobLockDocument } from './job-lock.schema';
import { MINUTE_MS } from '../../config/time.constants';

/** How long a lease is held before it is considered abandoned. */
export const DEFAULT_LOCK_TTL_MS = 15 * MINUTE_MS;

/** Identifies this process in a lease, for diagnosing a stuck job. */
const OWNER = `${hostname()}#${process.pid}`;

/**
 * Lets exactly one instance run a scheduled job at a time.
 *
 * Backed by a unique key in Mongo rather than an in-process flag, so it holds
 * across however many servers are behind the load balancer.
 */
@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);

  constructor(
    @InjectModel(JobLock.name) private lockModel: Model<JobLockDocument>,
  ) {}

  /**
   * Runs `work` only if this instance wins the lease; returns `null` when
   * another instance already holds it.
   *
   * The lease is always released, and released only by its holder — a slow run
   * whose lease already expired must not delete whoever picked it up next.
   */
  async runExclusively<T>(
    key: string,
    work: () => Promise<T>,
    ttlMs = DEFAULT_LOCK_TTL_MS,
  ): Promise<T | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    let acquired = false;
    try {
      // Takes the lease when it is free or already expired; the unique index
      // makes this atomic across instances.
      await this.lockModel
        .findOneAndUpdate(
          { key, expiresAt: { $lte: now } },
          { key, owner: OWNER, expiresAt },
          { upsert: true, returnDocument: 'after' },
        )
        .exec();
      acquired = true;
    } catch (err: any) {
      if (err?.code === 11000) {
        // Someone else holds an unexpired lease.
        this.logger.debug(`${key}: already running elsewhere`);
        return null;
      }
      throw err;
    }

    if (!acquired) return null;

    try {
      return await work();
    } finally {
      await this.lockModel
        .deleteOne({ key, owner: OWNER })
        .exec()
        .catch(() => undefined);
    }
  }
}
