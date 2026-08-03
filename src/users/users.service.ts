import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  /**
   * Drop legacy global unique `email_1` so members can have null email.
   * Partial unique index is defined on the schema.
   */
  async onModuleInit() {
    try {
      const indexes = await this.userModel.collection.indexes();
      const legacy = indexes.find(
        (idx) =>
          idx.name === 'email_1' &&
          !(idx as { partialFilterExpression?: unknown }).partialFilterExpression,
      );
      if (legacy) {
        await this.userModel.collection.dropIndex('email_1');
        this.logger.log('Dropped legacy unique index email_1');
      }
      await this.userModel.syncIndexes();
    } catch (err) {
      this.logger.warn(
        `User index sync skipped/failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async updateRefreshToken(
    userId: string,
    refreshToken: string | null,
  ): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, { refreshToken }).exec();
  }

  async create(userData: Partial<User>): Promise<UserDocument> {
    const user = new this.userModel(userData);
    return user.save();
  }
}
