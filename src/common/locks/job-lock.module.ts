import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JobLock, JobLockSchema } from './job-lock.schema';
import { JobLockService } from './job-lock.service';

/** Global so any scheduled job can claim a lease without extra wiring. */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: JobLock.name, schema: JobLockSchema }]),
  ],
  providers: [JobLockService],
  exports: [JobLockService],
})
export class JobLockModule {}
