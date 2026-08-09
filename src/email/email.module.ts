import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailService } from './email.service';
import { EmailTemplatesService } from './email-templates.service';
import { EmailTemplatesController } from './email-templates.controller';
import {
  EmailTemplate,
  EmailTemplateSchema,
} from './schemas/email-template.schema';
import {
  GymSettings,
  GymSettingsSchema,
} from '../gym-settings/schemas/gym-settings.schema';

/**
 * Global so any feature module can inject EmailService / EmailTemplatesService
 * without re-importing EmailModule each time.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailTemplate.name, schema: EmailTemplateSchema },
      { name: GymSettings.name, schema: GymSettingsSchema },
    ]),
  ],
  providers: [EmailService, EmailTemplatesService],
  controllers: [EmailTemplatesController],
  exports: [EmailService, EmailTemplatesService],
})
export class EmailModule {}
