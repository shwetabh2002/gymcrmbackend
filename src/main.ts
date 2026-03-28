import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as session from 'express-session';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  logger.log('🚀 Starting Backend GYM application...');
  logger.log(`📦 Node Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`🔢 Node Version: ${process.version}`);

  const app = await NestFactory.create(AppModule);

  // Enable session
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'gym-secret-key-change-in-production',
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: undefined, // Session cookie - expires on browser close
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
      },
    }),
  );
  logger.log('🔐 Session middleware enabled');

  // Enable CORS with credentials
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  logger.log('🌐 CORS enabled with credentials');

  // Enable global validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  logger.log('✅ Global validation pipes enabled');

  const port = process.env.PORT || 3000;
  const host = '0.0.0.0'; // Bind to all network interfaces for Render/Docker
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
