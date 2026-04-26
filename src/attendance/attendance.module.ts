import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceController } from './attendance.controller';
import { IclockController } from './iclock.controller';
import { AttendanceService } from './attendance.service';
import { EsslWebApiService } from './essl-web-api.service';
import { EsslSqlService } from './essl-sql.service';
import { Attendance, AttendanceSchema } from './schemas/attendance.schema';
import { EmployeesModule } from '../employees/employees.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attendance.name, schema: AttendanceSchema },
    ]),
    EmployeesModule, // Import to use EmployeesService
  ],
  controllers: [AttendanceController, IclockController],
  providers: [AttendanceService, EsslWebApiService, EsslSqlService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
