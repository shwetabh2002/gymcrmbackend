import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlatformPlan,
  PlatformPlanSchema,
} from './schemas/platform-plan.schema';
import {
  PlatformSubscription,
  PlatformSubscriptionSchema,
} from './schemas/platform-subscription.schema';
import {
  PlatformCharge,
  PlatformChargeSchema,
} from './schemas/platform-charge.schema';
import { Company, CompanySchema } from '../companies/schemas/company.schema';
import { Location, LocationSchema } from '../locations/schemas/location.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PlatformPlansService } from './platform-plans.service';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformChargingService } from './platform-charging.service';
import { PlatformBillingWorkerService } from './platform-billing-worker.service';
import {
  PlatformAdminController,
  PlatformBillingController,
} from './platform-billing.controller';
import { PaymentProviderModule } from '../payment-provider/payment-provider.module';
import { CountersModule } from '../counters/counters.module';

/**
 * Global so the subscription guard and any feature gate can be applied
 * anywhere without every module re-importing billing.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlatformPlan.name, schema: PlatformPlanSchema },
      { name: PlatformSubscription.name, schema: PlatformSubscriptionSchema },
      { name: PlatformCharge.name, schema: PlatformChargeSchema },
      { name: Company.name, schema: CompanySchema },
      { name: Location.name, schema: LocationSchema },
      { name: User.name, schema: UserSchema },
    ]),
    PaymentProviderModule,
    CountersModule,
  ],
  providers: [
    PlatformPlansService,
    PlatformBillingService,
    PlatformChargingService,
    PlatformBillingWorkerService,
  ],
  controllers: [PlatformBillingController, PlatformAdminController],
  exports: [
    PlatformPlansService,
    PlatformBillingService,
    PlatformChargingService,
    PlatformBillingWorkerService,
  ],
})
export class PlatformBillingModule {}
