import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Counter, CounterDocument } from './counter.schema';

@Injectable()
export class CountersService {
  constructor(
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
  ) {}

  /** Atomic increment for a named sequence key. */
  async next(key: string): Promise<number> {
    if (!key || key.includes('undefined') || key.includes('null')) {
      throw new BadRequestException(`Invalid counter key: ${key}`);
    }
    const counter = await this.counterModel
      .findOneAndUpdate(
        { key },
        { $inc: { seq: 1 } },
        { returnDocument: 'after', upsert: true },
      )
      .exec();
    return counter!.seq;
  }

  /** Per-company invoice number: INV-YYYYMMDD-NNNN */
  async nextInvoiceNumber(companyId: string): Promise<string> {
    if (!companyId) {
      throw new BadRequestException(
        'companyId is required to generate invoice numbers',
      );
    }
    const seq = await this.next(`invoice:${companyId}`);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `INV-${dateStr}-${String(seq).padStart(4, '0')}`;
  }

  /** Per-company member ID: PREFIX-0001 */
  async nextMemberId(prefix: string, companyId: string): Promise<string> {
    if (!companyId) {
      throw new BadRequestException(
        'companyId is required to generate member IDs',
      );
    }
    const clean = (prefix || 'GYM').trim().toUpperCase() || 'GYM';
    const seq = await this.next(`member:${companyId}`);
    return `${clean}-${String(seq).padStart(4, '0')}`;
  }
}
