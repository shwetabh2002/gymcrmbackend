import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SubscriptionPlansModule } from './subscription-plans/subscription-plans.module';
import { MembersModule } from './members/members.module';
import { MemberSubscriptionsModule } from './member-subscriptions/member-subscriptions.module';

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
    AuthModule,
    UsersModule,
    SubscriptionPlansModule,
    MembersModule,
    MemberSubscriptionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
