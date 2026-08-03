import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import {
  WhatsAppAccount,
  WhatsAppAccountSchema,
} from './schemas/whatsapp-account.schema';
import {
  WhatsAppMessage,
  WhatsAppMessageSchema,
} from './schemas/whatsapp-message.schema';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhatsAppAccount.name, schema: WhatsAppAccountSchema },
      { name: WhatsAppMessage.name, schema: WhatsAppMessageSchema },
    ]),
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, TokenEncryptionService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
