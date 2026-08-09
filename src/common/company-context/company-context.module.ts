import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Company, CompanySchema } from '../../companies/schemas/company.schema';
import { CompanyContextService } from './company-context.service';

/**
 * Global so any service can format money or phone numbers for a tenant without
 * every module re-importing the Company model.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Company.name, schema: CompanySchema }]),
  ],
  providers: [CompanyContextService],
  exports: [CompanyContextService],
})
export class CompanyContextModule {}
