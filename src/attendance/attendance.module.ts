import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceController } from './attendance.controller';
import { IclockController } from './iclock.controller';
import { AttendanceService } from './attendance.service';
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
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
