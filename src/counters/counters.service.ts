import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Counter, CounterDocument } from './counter.schema';

@Injectable()
export class CountersService {
  constructor(
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
  ) {}

  /**
   * Atomically increment and return the next value for a sequence key.
   * The `findOneAndUpdate` + `$inc` is atomic on a single document, so
   * concurrent callers never receive the same number (P0-8).
   */
  async next(key: string): Promise<number> {
    const counter = await this.counterModel
      .findOneAndUpdate(
        { key },
        { $inc: { seq: 1 } },
        { new: true, upsert: true },
      )
      .exec();
    return counter.seq;
  }

  /**
   * Collision-free invoice number: INV-YYYYMMDD-NNNN.
   * NOTE: on a database that already has invoices from the old
   * `countDocuments()+1` scheme, initialize the "invoice" counter's `seq`
   * to the current invoice count once, so new numbers don't clash with
   * legacy ones (the unique index on invoiceNumber is the backstop).
   */
  async nextInvoiceNumber(): Promise<string> {
    const seq = await this.next('invoice');
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `INV-${dateStr}-${String(seq).padStart(4, '0')}`;
  }
}
