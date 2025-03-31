import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import * as path from 'path';
import { ConfigService } from './config/config.service';

async function bootstrap() {
  // Create custom logger for bootstrap process
  const logger = new Logger('Bootstrap');

  try {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: ['error', 'warn', 'log', 'debug'],
    });

    // Get config service
    const configService = app.get(ConfigService);

    // Set up static files
    app.useStaticAssets(path.join(__dirname, '..', 'public'));

    // Get port from environment or use default
    const port = parseInt(configService.get('PORT', '3000'), 10);

    // Set up CORS
    app.enableCors({
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    });

    // Set global prefix
    app.setGlobalPrefix('api', { exclude: [''] });

    // Handle MongoDB connection issues
    process.on('unhandledRejection', (reason: any) => {
      if (reason && reason.message && reason.message.includes('_mongodb')) {
        logger.warn('MongoDB connection failed. Running in memory-only mode.');
        logger.warn(
          'Data will not be persisted when the application restarts.',
        );
      } else {
        logger.error(`Unhandled Rejection: ${String(reason)}`);
      }
    });

    // Start the application
    await app.listen(port);

    logger.log(`Application started successfully on port ${port}`);
    logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.log(`Server URL: http://localhost:${port}`);
  } catch (err: unknown) {
    const error = err as Error;
    logger.error(`Failed to start application: ${error.message}`);
    if (error.stack) {
      logger.error(`Stack trace: ${error.stack}`);
    }
    process.exit(1);
  }
}

// Add graceful shutdown handling
process.on('SIGINT', () => {
  const logger = new Logger('Shutdown');
  logger.log('Received SIGINT signal. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  const logger = new Logger('Shutdown');
  logger.log('Received SIGTERM signal. Shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  const logger = new Logger('UnhandledRejection');
  logger.error(`Unhandled Rejection at promise: ${String(promise)}`);
  logger.error(`Reason: ${String(reason)}`);
});

process.on('uncaughtException', (error: Error) => {
  const logger = new Logger('UncaughtException');
  logger.error(`Uncaught Exception: ${error.message}`);
  if (error.stack) {
    logger.error(`Stack trace: ${error.stack}`);
  }
  process.exit(1);
});

bootstrap();
