import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  logger.log('🚀 Starting Backend GYM application...');
  logger.log(`📦 Node Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`🔢 Node Version: ${process.version}`);
  logger.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3001'}`);

  const app = await NestFactory.create(AppModule);

  // Enable CORS with credentials
  // When credentials: true, we MUST use a function or specific origins (not wildcard)
  const baseOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://localhost:5173',
    'https://gymcrmfrontend.onrender.com',
    'https://crm.crmdalyfstylefitness.in',
    'https://crmdalyfstylefitness.in',
    'http://13.233.134.248',
    'https://13.233.134.248',
  ];

  const extraFromEnv =
    process.env.ADDITIONAL_CORS_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? [];
  const frontendUrl = process.env.FRONTEND_URL?.trim();
  if (frontendUrl && !baseOrigins.includes(frontendUrl)) {
    extraFromEnv.push(frontendUrl);
  }
  const allowedOrigins = [...new Set([...baseOrigins, ...extraFromEnv])];

  /** In development, allow browsers on the same LAN (e.g. phone → http://192.168.1.10:3000). */
  const isDevPrivateLanOrigin = (origin: string): boolean => {
    if (process.env.NODE_ENV === 'production') return false;
    try {
      const u = new URL(origin);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      const h = u.hostname;
      if (h === 'localhost' || h === '127.0.0.1') return false; // already in list
      return (
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)
      );
    } catch {
      return false;
    }
  };

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, curl)
      if (!origin) return callback(null, true);

      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (isDevPrivateLanOrigin(origin)) {
        return callback(null, true);
      }

      // Log rejected origins for debugging
      logger.warn(`🚫 CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Employee-Password',
      'Accept',
      'Origin',
      'Referer',
      'User-Agent',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
    ],
    exposedHeaders: ['Authorization'],
    maxAge: 86400, // 24 hours
  });
  logger.log(
    `🌐 CORS: ${allowedOrigins.length} static origins; dev LAN origins allowed when NODE_ENV !== production`,
  );

  // Enable global validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      skipMissingProperties: false,
      skipNullProperties: false,
      skipUndefinedProperties: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
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
