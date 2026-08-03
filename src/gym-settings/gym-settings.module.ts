import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GymSettingsService } from './gym-settings.service';
import { GymSettingsController } from './gym-settings.controller';
import {
  GymSettings,
  GymSettingsSchema,
} from './schemas/gym-settings.schema';
import { Company, CompanySchema } from '../companies/schemas/company.schema';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GymSettings.name, schema: GymSettingsSchema },
      { name: Company.name, schema: CompanySchema },
    ]),
    StorageModule,
  ],
  controllers: [GymSettingsController],
  providers: [GymSettingsService],
  exports: [GymSettingsService],
})
export class GymSettingsModule {}
