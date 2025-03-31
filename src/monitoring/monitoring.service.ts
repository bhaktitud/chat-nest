import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorLoggingService } from './error-logging.service';
import { MonitoringConfig } from './monitoring.config';
import * as os from 'os';

interface PerformanceMetrics {
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

@Injectable()
export class MonitoringService implements OnModuleInit {
  private metricsInterval: NodeJS.Timeout;
  private readonly metrics: PerformanceMetrics[] = [];
  private readonly maxMetricsLength = 1000; // Keep last 1000 metrics points
  private lastEventLoopTimestamp: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly errorLoggingService: ErrorLoggingService,
  ) {
    this.lastEventLoopTimestamp = Date.now();
  }

  onModuleInit() {
    // Start collecting metrics
    this.startMetricsCollection();
  }

  onModuleDestroy() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }

  /**
   * Start collecting performance metrics
   */
  private startMetricsCollection() {
    const config = this.configService.get<MonitoringConfig>('monitoring');
    if (!config?.metrics) {
      throw new Error('Metrics configuration is not available');
    }

    // Collect metrics every 5 seconds by default
    const interval = config.metrics.collectionIntervalMs;

    this.metricsInterval = setInterval(() => {
      this.collectMetrics().catch((error) => {
        this.errorLoggingService.logError(
          error instanceof Error ? error : new Error(String(error)),
          'MetricsCollection',
          { interval },
        );
      });
    }, interval);
  }

  /**
   * Collect current performance metrics
   */
  private async collectMetrics(): Promise<void> {
    const currentTimestamp = Date.now();
    const eventLoopLag = currentTimestamp - this.lastEventLoopTimestamp;
    this.lastEventLoopTimestamp = currentTimestamp;

    const metrics: PerformanceMetrics = {
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
      cpu: {
        loadAvg: os.loadavg(),
        usage: await this.getCPUUsage(),
      },
      eventLoop: {
        latency: await this.measureEventLoopLatency(),
        lag: eventLoopLag,
      },
      uptime: process.uptime(),
    };

    // Add metrics to the array
    this.metrics.push(metrics);

    // Keep only the last N metrics points
    if (this.metrics.length > this.maxMetricsLength) {
      this.metrics.shift();
    }

    // Log metrics if they exceed thresholds
    this.checkMetricsThresholds(metrics);
  }

  /**
   * Get CPU usage as a percentage
   */
  private async getCPUUsage(): Promise<number> {
    const startUsage = process.cpuUsage();

    // Wait for 100ms to get a meaningful measurement
    await new Promise((resolve) => setTimeout(resolve, 100));

    const endUsage = process.cpuUsage(startUsage);
    const totalUsage = endUsage.user + endUsage.system;

    // Convert to percentage (considering the 100ms measurement window)
    return (totalUsage / 1000) * 100;
  }

  /**
   * Measure event loop latency
   */
  private async measureEventLoopLatency(): Promise<number> {
    const start = process.hrtime();

    // Wait for next tick
    await new Promise((resolve) => setImmediate(resolve));

    const [seconds, nanoseconds] = process.hrtime(start);
    return seconds * 1000 + nanoseconds / 1000000; // Convert to milliseconds
  }

  /**
   * Check if metrics exceed defined thresholds
   */
  private checkMetricsThresholds(metrics: PerformanceMetrics): void {
    const config = this.configService.get<MonitoringConfig>('monitoring');
    if (!config?.metrics?.thresholds) return;

    const { thresholds } = config.metrics;

    // Check memory usage
    const heapUsedPercent =
      (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100;
    if (heapUsedPercent > thresholds.heapUsagePercent) {
      this.errorLoggingService.logWarning(
        `High heap usage detected: ${heapUsedPercent.toFixed(2)}%`,
        'MemoryMonitoring',
        { metrics: metrics.memory },
      );
    }

    // Check CPU usage
    if (metrics.cpu.usage > thresholds.cpuPercent) {
      this.errorLoggingService.logWarning(
        `High CPU usage detected: ${metrics.cpu.usage.toFixed(2)}%`,
        'CPUMonitoring',
        { metrics: metrics.cpu },
      );
    }

    // Check event loop lag
    if (metrics.eventLoop.lag > thresholds.eventLoopLagMs) {
      this.errorLoggingService.logWarning(
        `High event loop lag detected: ${metrics.eventLoop.lag}ms`,
        'EventLoopMonitoring',
        { metrics: metrics.eventLoop },
      );
    }
  }

  /**
   * Get collected metrics
   */
  getMetrics(minutes = 5): PerformanceMetrics[] {
    const threshold = Date.now() - minutes * 60 * 1000;
    return this.metrics.filter(
      (metric) => new Date(metric.timestamp).getTime() > threshold,
    );
  }

  /**
   * Get current system health status
   */
  getHealthStatus(): Record<string, unknown> {
    const latestMetrics = this.metrics[this.metrics.length - 1];
    if (!latestMetrics) {
      return {
        status: 'unknown',
        timestamp: new Date().toISOString(),
      };
    }

    const heapUsedPercent =
      (latestMetrics.memory.heapUsed / latestMetrics.memory.heapTotal) * 100;

    return {
      status: 'healthy',
      timestamp: latestMetrics.timestamp,
      metrics: {
        memory: {
          heapUsedPercent: heapUsedPercent.toFixed(2) + '%',
          ...latestMetrics.memory,
        },
        cpu: latestMetrics.cpu,
        eventLoop: latestMetrics.eventLoop,
        uptime: latestMetrics.uptime,
      },
    };
  }
}
