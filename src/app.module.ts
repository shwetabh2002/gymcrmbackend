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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
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
            connection.on('connected', () => {
              logger.log('✅ MongoDB connected successfully!');
              logger.log(`📊 Database: ${connection.name}`);
              logger.log(`🏠 Host: ${connection.host}`);
              logger.log(`🔌 Port: ${connection.port}`);
            });

            connection.on('disconnected', () => {
              logger.warn('⚠️  MongoDB disconnected');
            });

            connection.on('error', (error) => {
              logger.error('❌ MongoDB connection error:', error.message);
            });

            connection.on('reconnected', () => {
              logger.log('🔄 MongoDB reconnected');
            });

            return connection;
          },
        };
      },
    }),
    // Global rate limiting : 100 requests / minute per IP by default.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    AuthModule,
    UsersModule,
    SubscriptionPlansModule,
    MembersModule,
    MemberSubscriptionsModule,
    PaymentsModule,
    InvoicesModule,
    AnalyticsModule,
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
