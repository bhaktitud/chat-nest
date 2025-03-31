import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from './monitoring/http-exception.filter';
import { ErrorLoggingService } from './monitoring/error-logging.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import helmet from 'helmet';
import * as compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Get the error logging service
  const errorLoggingService = app.get(ErrorLoggingService);

  // Global filters and pipes
  app.useGlobalFilters(new GlobalExceptionFilter(errorLoggingService));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Security middleware
  app.use(helmet());
  app.use(compression());
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Use the built-in ThrottlerGuard
  const throttlerGuard = app.get(ThrottlerGuard);
  app.useGlobalGuards(throttlerGuard);

  // Start the server
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on port ${port}`);

  // Log application startup
  errorLoggingService.logInfo(
    `Application started on port ${port}`,
    'Bootstrap',
    {
      environment: process.env.NODE_ENV || 'development',
      port,
    },
  );
}

// Handle uncaught exceptions at the process level
process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  // Get error logging service if available
  try {
    const app = await NestFactory.createApplicationContext(AppModule);
    await app.init();
    const errorLoggingService = app.get(ErrorLoggingService);
    errorLoggingService.logError(error, 'UncaughtException', {
      processId: process.pid,
    });
    await app.close();
    process.exit(1);
  } catch {
    // If we can't initialize the app context, just exit
    process.exit(1);
  }
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Similar handling as uncaught exceptions
  try {
    const app = await NestFactory.createApplicationContext(AppModule);
    await app.init();
    const errorLoggingService = app.get(ErrorLoggingService);
    errorLoggingService.logError(
      reason instanceof Error ? reason : new Error(String(reason)),
      'UnhandledRejection',
      { processId: process.pid },
    );
    await app.close();
  } catch {
    // If we can't initialize the app context, just log to console
    console.error('Failed to log unhandled rejection properly');
  }
});

bootstrap();
