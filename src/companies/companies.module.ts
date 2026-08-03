import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { Company, CompanySchema } from './schemas/company.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  GymSettings,
  GymSettingsSchema,
} from '../gym-settings/schemas/gym-settings.schema';
import { AuthModule } from '../auth/auth.module';
import { LocationsModule } from '../locations/locations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Company.name, schema: CompanySchema },
      { name: User.name, schema: UserSchema },
      { name: GymSettings.name, schema: GymSettingsSchema },
    ]),
    AuthModule,
    LocationsModule,
  ],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService, MongooseModule],
})
export class CompaniesModule {}
