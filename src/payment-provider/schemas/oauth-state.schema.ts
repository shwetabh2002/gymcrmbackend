import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type OAuthStateDocument = OAuthState & Document;

/**
 * One pending Razorpay OAuth handshake.
 *
 * Persisted rather than held in memory because the browser leaves for
 * Razorpay and comes back later: a restart or a second instance behind a load
 * balancer would otherwise lose the state and fail every connect.
 *
 * Single-use — redeemed rows are deleted, and Mongo expires stragglers.
 */
@Schema({ timestamps: true })
export class OAuthState {
  /** The `state` parameter echoed back by Razorpay. */
  @Prop({ type: String, required: true, unique: true, index: true })
  state: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  })
  companyId: Types.ObjectId;

  /** Staff member who started the connect, for the audit trail. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  userId: Types.ObjectId;

  /** Mongo removes the row at this instant, so nothing is redeemable later. */
  @Prop({ type: Date, required: true })
  expiresAt: Date;
}

export const OAuthStateSchema = SchemaFactory.createForClass(OAuthState);

/** TTL cleanup — no cron needed. */
OAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
