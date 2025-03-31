import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { DatabaseModule } from './database/database.module';
import { ChatModule } from './chat/chat.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { Connection } from 'mongoose';
import { MonitoringModule } from './monitoring/monitoring.module';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { GlobalExceptionFilter } from './monitoring/http-exception.filter';
import { RequestLoggerMiddleware } from './monitoring/request-logger.middleware';

@Module({
  imports: [
    ConfigModule,
    MonitoringModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60,
          limit: 20,
        },
      ],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Format the URI to avoid SRV issues
        const uri = configService.mongodbUri;

        return {
          uri: uri,
          // Remove deprecated options
          connectionFactory: (connection: Connection) => {
            connection.on('connected', () => {
              console.log('MongoDB connected successfully');
            });
            connection.on('disconnected', () => {
              console.log('MongoDB disconnected');
            });
            connection.on('error', (error: Error) => {
              console.log('MongoDB connection error:', error.message);
            });
            return connection;
          },
          serverSelectionTimeoutMS: 5000,
          heartbeatFrequencyMS: 10000,
          socketTimeoutMS: 45000,
          family: 4,
          maxPoolSize: 20,
          minPoolSize: 5,
          maxIdleTimeMS: 30000,
          waitQueueTimeoutMS: 3000,
          retryWrites: true,
          retryReads: true,
        };
      },
    }),
    DatabaseModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*'); // Apply to all routes
  }
}
