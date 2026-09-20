import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SubscriptionPlansModule } from './subscription-plans/subscription-plans.module';
import { MembersModule } from './members/members.module';
import { MemberSubscriptionsModule } from './member-subscriptions/member-subscriptions.module';
import { PaymentsModule } from './payments/payments.module';
import { InvoicesModule } from './invoices/invoices.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { RenewalsModule } from './renewals/renewals.module';
import { DuesModule } from './dues/dues.module';
import { EmployeesModule } from './employees/employees.module';
import { GymSettingsModule } from './gym-settings/gym-settings.module';
import { ActivityLogsModule } from './activity-logs/activity-logs.module';
import { CompaniesModule } from './companies/companies.module';
import { LocationsModule } from './locations/locations.module';
import { EmailModule } from './email/email.module';
import { PaymentProviderModule } from './payment-provider/payment-provider.module';
import { CheckoutModule } from './checkout/checkout.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AutopayModule } from './autopay/autopay.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { RuntimeModule } from './common/runtime/runtime.module';
import { CompanyContextModule } from './common/company-context/company-context.module';
import { JobLockModule } from './common/locks/job-lock.module';
import { PlatformBillingModule } from './platform-billing/platform-billing.module';
import { GLOBAL_THROTTLE } from './config/throttle.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    RuntimeModule,
    CompanyContextModule,
    JobLockModule,
    PlatformBillingModule,
    EmailModule,
    WhatsAppModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('MongoDBConnection');
        const mongoUri = configService.get<string>('MONGODB_URI');

        // Log MongoDB connection details (hide password)
        const sanitizedUri = mongoUri?.replace(
          /\/\/([^:]+):([^@]+)@/,
          '//$1:****@',
        );

        logger.log(`🔄 Attempting to connect to MongoDB...`);
        logger.log(`📍 URI: ${sanitizedUri}`);
        logger.log(`🌍 Environment: ${configService.get('NODE_ENV')}`);

        return {
          uri: mongoUri,
          connectionFactory: (connection) => {
            let loggedOnce = false;
            const logConnected = (reason: string) => {
              if (loggedOnce) return;
              loggedOnce = true;
              logger.log(`✅ MongoDB connected successfully (${reason})`);
              logger.log(`📊 Database: ${connection.name}`);
              const host =
                connection.host != null
                  ? `${connection.host}${connection.port != null ? `:${connection.port}` : ''}`
                  : 'n/a';
              logger.log(`🏠 Host: ${host}`);
              logger.log(`🔌 readyState: ${connection.readyState} (1=connected)`);
            };

            // Mongoose often finishes connecting before listeners attach, so
            // the 'connected' event never fires on first boot — check now.
            if (connection.readyState === 1) {
              logConnected('already open');
            }

            connection.on('connected', () => logConnected('connected event'));
            connection.on('open', () => logConnected('open event'));

            connection.on('disconnected', () => {
              loggedOnce = false;
              logger.warn('⚠️  MongoDB disconnected');
            });

            connection.on('error', (error: Error) => {
              logger.error(`❌ MongoDB connection error: ${error.message}`);
            });

            connection.on('reconnected', () => {
              loggedOnce = false;
              logConnected('reconnected');
            });

            return connection;
          },
        };
      },
    }),
    // Global rate limiting — values live in config/throttle.config.ts
    ThrottlerModule.forRoot([GLOBAL_THROTTLE]),
    AuthModule,
    UsersModule,
    CompaniesModule,
    LocationsModule,
    SubscriptionPlansModule,
    MembersModule,
    MemberSubscriptionsModule,
    PaymentProviderModule,
    PaymentsModule,
    InvoicesModule,
    AnalyticsModule,
    RenewalsModule,
    DuesModule,
    EmployeesModule,
    GymSettingsModule,
    ActivityLogsModule,
    CheckoutModule,
    WebhooksModule,
    AutopayModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply the throttler to every route; stricter per-route limits via @Throttle().
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
