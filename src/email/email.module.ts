import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Global so any feature module can inject EmailService
 * without re-importing EmailModule each time.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
