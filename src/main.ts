import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/mongoose';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { Connection } from 'mongoose';
import helmet from 'helmet';
import { RuntimeService } from './common/runtime/runtime.service';

/** Listen on every interface so containers and LAN devices can reach the API. */
const BIND_ALL_INTERFACES = '0.0.0.0';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  logger.log('🚀 Starting Backend GYM application...');
  logger.log(`📦 Node Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`🔢 Node Version: ${process.version}`);

  // rawBody is what Razorpay signs — without it webhook verification cannot work.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Explicit boot-time Mongo status (connectionFactory events can be missed).
  const mongo = app.get<Connection>(getConnectionToken());
  if (mongo.readyState === 1) {
    logger.log(
      `✅ MongoDB connected successfully · db=${mongo.name} · host=${mongo.host ?? 'n/a'}`,
    );
  } else {
    logger.error(
      `❌ MongoDB not connected at boot (readyState=${mongo.readyState}; expected 1)`,
    );
  }

  // Refuse to run a production server on development secrets / mock providers.
  const runtime = app.get(RuntimeService);
  const problems = runtime.productionProblems();
  if (problems.length) {
    logger.error('❌ Refusing to start in production:');
    problems.forEach((p) => logger.error(`   • ${p}`));
    await app.close();
    process.exit(1);
  }
  runtime.logMode();

  // Security headers — allow CRM (other origin) to load S3 images via CORS/canvas
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const port = runtime.port();
  const host = BIND_ALL_INTERFACES; // Render/Docker need every interface

  // CORS must run early so stamp/logo <img crossOrigin> works from CRM
  const origins = runtime.corsOrigins();
  app.enableCors({ origin: origins, credentials: true });
  logger.log(`🌐 CORS: ${origins.join(', ')}`);

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

  const publicUrl = runtime.backendPublicUrl();

  logger.log('');
  logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.log(`🎯 Application is running on: ${publicUrl}`);
  logger.log(`🌐 Listening on: ${host}:${port}`);
  logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.log('');
  logger.log('📋 Available Endpoints:');
  logger.log(`   POST   ${publicUrl}/auth/admin/login`);
  logger.log(`   POST   ${publicUrl}/auth/refresh`);
  logger.log(`   POST   ${publicUrl}/auth/logout`);
  logger.log('');
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('❌ Failed to start application:', error.message);
  logger.error(error.stack);
  process.exit(1);
});
