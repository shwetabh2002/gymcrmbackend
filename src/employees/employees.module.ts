import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { StorageModule } from '../storage/storage.module';
import { LocationsModule } from '../locations/locations.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    ActivityLogsModule,
    StorageModule,
    LocationsModule,
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
