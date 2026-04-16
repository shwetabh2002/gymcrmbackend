import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

/**
 * Drops legacy unique index on `email` when schema no longer declares it unique.
 */
@Injectable()
export class UserIndexesService implements OnModuleInit {
  private readonly logger = new Logger(UserIndexesService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async onModuleInit() {
    try {
      await this.userModel.syncIndexes();
      this.logger.log('User collection indexes synced.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`User index sync: ${msg}`);
    }
  }
}
