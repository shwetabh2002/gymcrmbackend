import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PaymentProviderAccount,
  PaymentProviderAccountSchema,
} from './schemas/payment-provider-account.schema';
import { OAuthState, OAuthStateSchema } from './schemas/oauth-state.schema';
import { PaymentProviderService } from './payment-provider.service';
import { PaymentProviderController } from './payment-provider.controller';
import { RazorpayApiService } from './razorpay-api.service';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: PaymentProviderAccount.name,
        schema: PaymentProviderAccountSchema,
      },
      { name: OAuthState.name, schema: OAuthStateSchema },
    ]),
  ],
  providers: [
    PaymentProviderService,
    RazorpayApiService,
    TokenEncryptionService,
  ],
  controllers: [PaymentProviderController],
  exports: [PaymentProviderService, RazorpayApiService, TokenEncryptionService],
})
export class PaymentProviderModule {}
