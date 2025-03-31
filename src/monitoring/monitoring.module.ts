import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ErrorLoggingService } from './error-logging.service';
import { GlobalExceptionFilter } from './http-exception.filter';
import { WebSocketExceptionFilter } from './ws-exception.filter';
import { RequestLoggerMiddleware } from './request-logger.middleware';
import { MonitoringService } from './monitoring.service';
import { HealthController } from './health.controller';
import monitoringConfig from './monitoring.config';

@Global()
@Module({
  imports: [ConfigModule.forFeature(monitoringConfig)],
  providers: [
    ErrorLoggingService,
    MonitoringService,
    GlobalExceptionFilter,
    WebSocketExceptionFilter,
    RequestLoggerMiddleware,
    HealthController,
  ],
  exports: [
    ErrorLoggingService,
    MonitoringService,
    GlobalExceptionFilter,
    WebSocketExceptionFilter,
    RequestLoggerMiddleware,
  ],
  controllers: [HealthController],
})
export class MonitoringModule {}
