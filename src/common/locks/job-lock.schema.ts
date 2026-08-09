import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type JobLockDocument = JobLock & Document;

/**
 * A lease held by one instance while it runs a scheduled job.
 *
 * The autopay sweep guarded itself with an in-process flag, which only works
 * while there is exactly one server. Behind a load balancer every instance runs
 * its own timer, so they would sweep the same due subscriptions at the same
 * moment. The per-mandate 20-hour guard still prevents a double debit, but two
 * instances racing on the same rows is not something to rely on.
 *
 * The lease is time-bound: if the holder dies mid-sweep the lock expires on its
 * own and the next run picks the work up.
 */
@Schema({ timestamps: true })
export class JobLock {
  /** Job name, e.g. 'autopay-sweep'. One row per job. */
  @Prop({ type: String, required: true, unique: true, index: true })
  key: string;

  /** Which process holds it — only for diagnosing a stuck lease. */
  @Prop({ type: String, required: true })
  owner: string;

  /** After this the lease is considered abandoned and can be taken. */
  @Prop({ type: Date, required: true })
  expiresAt: Date;
}

export const JobLockSchema = SchemaFactory.createForClass(JobLock);

/** Mongo removes abandoned leases without a cleanup job. */
JobLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
