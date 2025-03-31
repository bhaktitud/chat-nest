import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ErrorLoggingService } from './error-logging.service';

interface HealthResponse {
  status: string;
  timestamp: string;
  metrics?: {
    memory: {
      heapUsedPercent: string;
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
    cpu: {
      loadAvg: number[];
      usage: number;
    };
    eventLoop: {
      latency: number;
      lag: number;
    };
    uptime: number;
  };
}

interface MetricsResponse {
  timestamp: string;
  memory: NodeJS.MemoryUsage;
  cpu: {
    loadAvg: number[];
    usage: number;
  };
  eventLoop: {
    latency: number;
    lag: number;
  };
  uptime: number;
}

@Controller('health')
@UseGuards(ThrottlerGuard)
export class HealthController {
  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly errorLoggingService: ErrorLoggingService,
  ) {}

  @Get()
  getHealth(): HealthResponse {
    const status = this.monitoringService.getHealthStatus();
    return {
      status: status.status as string,
      timestamp: status.timestamp as string,
      metrics: status.metrics as HealthResponse['metrics'],
    };
  }

  @Get('metrics')
  getMetrics(@Query('minutes') minutes?: string): MetricsResponse[] {
    try {
      const timeWindow = minutes ? parseInt(minutes, 10) : 5;
      if (isNaN(timeWindow) || timeWindow <= 0) {
        throw new HttpException(
          'Invalid minutes parameter',
          HttpStatus.BAD_REQUEST,
        );
      }
      return this.monitoringService.getMetrics(timeWindow) as MetricsResponse[];
    } catch (error) {
      this.errorLoggingService.logError(
        error instanceof Error ? error : new Error(String(error)),
        'HealthController',
        { minutes },
      );
      throw error;
    }
  }

  @Get('logs')
  getLogs(@Query('days') days?: string): Promise<string> {
    try {
      const timeWindow = days ? parseInt(days, 10) : 1;
      if (isNaN(timeWindow) || timeWindow <= 0) {
        throw new HttpException(
          'Invalid days parameter',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Return a simple message since exportLogs is not implemented
      return Promise.resolve(
        JSON.stringify({
          message: 'Log export functionality is not implemented yet',
          requestedDays: timeWindow,
        }),
      );
    } catch (error) {
      this.errorLoggingService.logError(
        error instanceof Error ? error : new Error(String(error)),
        'HealthController',
        { days },
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to retrieve logs',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
