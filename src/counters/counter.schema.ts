import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CounterDocument = Counter & Document;

/**
 * Named atomic counter. One document per sequence key (e.g. "invoice").
 * Used to generate collision-free sequential numbers without a race (P0-8).
 */
@Schema()
export class Counter {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true, default: 0 })
  seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
