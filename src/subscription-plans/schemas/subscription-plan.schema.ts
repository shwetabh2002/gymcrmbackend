import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { DurationType } from '../../common/enums/duration-type.enum';
import { PlanStatus } from '../../common/enums/plan-status.enum';

export type SubscriptionPlanDocument = SubscriptionPlan & Document;

@Schema({ timestamps: true })
export class SubscriptionPlan {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  duration: number; // e.g., 30, 3, 1

  @Prop({ type: String, enum: DurationType, required: true })
  durationType: DurationType; // DAYS, MONTHS, YEARS

  @Prop({ required: true })
  price: number;

  @Prop({ type: String, default: null })
  description: string | null;

  @Prop({ type: String, enum: PlanStatus, default: PlanStatus.ACTIVE })
  status: PlanStatus;
}

export const SubscriptionPlanSchema =
  SchemaFactory.createForClass(SubscriptionPlan);
