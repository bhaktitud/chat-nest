import { registerAs } from '@nestjs/config';

export interface MonitoringConfig {
  logging: {
    maxLogSizeMB: number;
    maxLogFiles: number;
    logDirectory: string;
    logLevels: ('ERROR' | 'WARNING' | 'INFO' | 'DEBUG')[];
    enableDebugInProduction: boolean;
    rotationCheckIntervalMs: number;
  };
  metrics: {
    collectionIntervalMs: number;
    thresholds: {
      heapUsagePercent: number;
      cpuPercent: number;
      eventLoopLagMs: number;
    };
  };
  rateLimit: {
    ttl: number;
    limit: number;
    blockDuration: number;
  };
  externalServices: {
    sentry?: {
      dsn: string;
      environment: string;
      tracesSampleRate: number;
    };
    datadog?: {
      apiKey: string;
      appKey: string;
      serviceName: string;
    };
  };
}

export default registerAs(
  'monitoring',
  (): MonitoringConfig => ({
    logging: {
      maxLogSizeMB: parseInt(process.env.MAX_LOG_SIZE_MB || '10', 10),
      maxLogFiles: parseInt(process.env.MAX_LOG_FILES || '5', 10),
      logDirectory: process.env.LOG_DIRECTORY || 'logs',
      logLevels: (process.env.LOG_LEVELS || 'ERROR,WARNING,INFO,DEBUG').split(
        ',',
      ) as MonitoringConfig['logging']['logLevels'],
      enableDebugInProduction:
        process.env.ENABLE_DEBUG_IN_PRODUCTION === 'true',
      rotationCheckIntervalMs: parseInt(
        process.env.LOG_ROTATION_CHECK_INTERVAL_MS || '300000',
        10,
      ), // 5 minutes
    },
    metrics: {
      collectionIntervalMs: parseInt(
        process.env.METRICS_COLLECTION_INTERVAL_MS || '5000',
        10,
      ), // 5 seconds
      thresholds: {
        heapUsagePercent: parseInt(
          process.env.METRICS_HEAP_USAGE_THRESHOLD || '85',
          10,
        ), // 85%
        cpuPercent: parseInt(process.env.METRICS_CPU_THRESHOLD || '80', 10), // 80%
        eventLoopLagMs: parseInt(
          process.env.METRICS_EVENT_LOOP_LAG_THRESHOLD || '100',
          10,
        ), // 100ms
      },
    },
    rateLimit: {
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10), // 60 seconds
      limit: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10), // 100 requests
      blockDuration: parseInt(
        process.env.RATE_LIMIT_BLOCK_DURATION || '300',
        10,
      ), // 5 minutes
    },
    externalServices: {
      ...(process.env.SENTRY_DSN && {
        sentry: {
          dsn: process.env.SENTRY_DSN,
          environment: process.env.SENTRY_ENVIRONMENT || 'development',
          tracesSampleRate: parseFloat(
            process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0',
          ),
        },
      }),
      ...(process.env.DATADOG_API_KEY && {
        datadog: {
          apiKey: process.env.DATADOG_API_KEY,
          appKey: process.env.DATADOG_APP_KEY || '',
          serviceName: process.env.DATADOG_SERVICE_NAME || 'chat-engine',
        },
      }),
    },
  }),
);
