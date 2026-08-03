import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  logger.log('🚀 Starting Backend GYM application...');
  logger.log(`📦 Node Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`🔢 Node Version: ${process.version}`);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Security headers — allow CRM (other origin) to load S3 images via CORS/canvas
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const port = process.env.PORT || 3000;
  const host = '0.0.0.0'; // Bind to all network interfaces for Render/Docker

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const marketingUrl =
    process.env.MARKETING_URL || 'http://localhost:3001';
  const extra = (process.env.ADDITIONAL_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // CORS must run early so stamp/logo <img crossOrigin> works from CRM
  app.enableCors({
    origin: [frontendUrl, marketingUrl, ...extra],
    credentials: true,
  });
  logger.log(`🌐 CORS: ${[frontendUrl, marketingUrl, ...extra].join(', ')}`);

  // Enable global validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  logger.log('✅ Global validation pipes enabled');

  await app.listen(port, host);

  logger.log('');
  logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.log(`🎯 Application is running on: http://localhost:${port}`);
  logger.log(`🌐 Listening on: ${host}:${port}`);
  logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.log('');
  logger.log('📋 Available Endpoints:');
  logger.log(`   POST   http://localhost:${port}/auth/admin/login`);
  logger.log(`   POST   http://localhost:${port}/auth/refresh`);
  logger.log(`   POST   http://localhost:${port}/auth/logout`);
  logger.log('');
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('❌ Failed to start application:', error.message);
  logger.error(error.stack);
  process.exit(1);
});
