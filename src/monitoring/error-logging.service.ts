import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MonitoringConfig } from './monitoring.config';

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG';
  context: string;
  message: string;
  stackTrace?: string;
  additionalInfo?: Record<string, unknown>;
  system: SystemInfo;
}

interface SystemInfo {
  hostname: string;
  platform: string;
  memory: NodeJS.MemoryUsage;
  pid: number;
  uptime: number;
  nodeVersion: string;
}

@Injectable()
export class ErrorLoggingService {
  private readonly logger = new Logger('ErrorMonitoring');
  private readonly logFilePath: string;
  private readonly debugLogPath: string;
  private readonly maxLogSizeMB: number;
  private readonly maxLogFiles: number;
  private readonly systemInfo: SystemInfo;
  private readonly enableDebugInProduction: boolean;
  private readonly logLevels: Set<string>;
  private rotationCheckInterval: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.get<MonitoringConfig>('monitoring');
    if (!config) {
      throw new Error('Monitoring configuration is not available');
    }

    // Initialize logging configuration
    this.maxLogSizeMB = config.logging.maxLogSizeMB;
    this.maxLogFiles = config.logging.maxLogFiles;
    this.enableDebugInProduction = config.logging.enableDebugInProduction;
    this.logLevels = new Set(config.logging.logLevels);

    // Set up log directory
    const logDir = path.join(process.cwd(), config.logging.logDirectory);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.logFilePath = path.join(logDir, 'error.log');
    this.debugLogPath = path.join(logDir, 'debug.log');

    // Initialize system info
    this.systemInfo = {
      hostname: os.hostname(),
      platform: process.platform,
      memory: process.memoryUsage(),
      pid: process.pid,
      uptime: process.uptime(),
      nodeVersion: process.version,
    };

    // Set up log rotation check interval
    this.rotationCheckInterval = setInterval(
      () => this.checkLogRotation(),
      config.logging.rotationCheckIntervalMs,
    );

    // Initial log rotation check
    this.checkLogRotation();
  }

  onModuleDestroy() {
    if (this.rotationCheckInterval) {
      clearInterval(this.rotationCheckInterval);
    }
  }

  /**
   * Log an error with contextual information
   */
  logError(
    error: Error,
    context: string,
    additionalInfo?: Record<string, unknown>,
  ) {
    if (!this.logLevels.has('ERROR')) return;

    const timestamp = new Date().toISOString();
    const errorMessage = error.message;
    const stackTrace = error.stack || 'No stack trace available';

    const logEntry: LogEntry = {
      timestamp,
      level: 'ERROR',
      context,
      message: errorMessage,
      stackTrace,
      additionalInfo: additionalInfo || {},
      system: this.getSystemInfo(),
    };

    // Log to console
    this.logger.error(`[${context}] ${errorMessage}`, stackTrace);

    // Log to file
    this.appendToLogFile(JSON.stringify(logEntry) + '\n');

    // Report to external service if configured
    this.reportToExternalService(logEntry);
  }

  /**
   * Log a warning with contextual information
   */
  logWarning(
    message: string,
    context: string,
    additionalInfo?: Record<string, unknown>,
  ) {
    if (!this.logLevels.has('WARNING')) return;

    const timestamp = new Date().toISOString();

    const logEntry: LogEntry = {
      timestamp,
      level: 'WARNING',
      context,
      message,
      additionalInfo: additionalInfo || {},
      system: this.getSystemInfo(),
    };

    // Log to console
    this.logger.warn(`[${context}] ${message}`);

    // Log to file
    this.appendToLogFile(JSON.stringify(logEntry) + '\n');
  }

  /**
   * Log an informational message
   */
  logInfo(
    message: string,
    source: string,
    context?: Record<string, unknown>,
  ): void {
    if (!this.logLevels.has('INFO')) return;

    this.logger.log(message, source);

    // Create log entry
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      context: source,
      message,
      additionalInfo: context || {},
      system: this.getSystemInfo(),
    };

    // Log to file
    this.appendToLogFile(JSON.stringify(logEntry) + '\n');
  }

  /**
   * Log a debug message (only in non-production environments or if explicitly enabled)
   */
  logDebug(
    message: string,
    context: string,
    data?: Record<string, unknown>,
  ): void {
    if (!this.logLevels.has('DEBUG')) return;

    // Skip debug logging in production unless explicitly enabled
    if (
      process.env.NODE_ENV === 'production' &&
      !this.enableDebugInProduction
    ) {
      return;
    }

    this.logger.debug(`[${context}] ${message}`);

    // Log to separate debug file
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      context,
      message,
      additionalInfo: data || {},
      system: this.getSystemInfo(),
    };

    this.appendToDebugLog(JSON.stringify(logEntry) + '\n');
  }

  /**
   * Check if log rotation is needed and rotate if necessary
   */
  private checkLogRotation() {
    if (!fs.existsSync(this.logFilePath)) {
      return;
    }

    const stats = fs.statSync(this.logFilePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB >= this.maxLogSizeMB) {
      this.rotateLogFiles();
    }

    // Also check debug log
    if (fs.existsSync(this.debugLogPath)) {
      const debugStats = fs.statSync(this.debugLogPath);
      const debugFileSizeMB = debugStats.size / (1024 * 1024);

      if (debugFileSizeMB >= this.maxLogSizeMB) {
        this.rotateLogFiles(true);
      }
    }
  }

  /**
   * Rotate log files
   */
  private rotateLogFiles(isDebug = false) {
    const logPath = isDebug ? this.debugLogPath : this.logFilePath;
    const logDir = path.dirname(logPath);
    const baseName = path.basename(logPath, '.log');

    // Delete oldest log file if maximum is reached
    const oldestLogFile = path.join(
      logDir,
      `${baseName}.${this.maxLogFiles}.log`,
    );
    if (fs.existsSync(oldestLogFile)) {
      fs.unlinkSync(oldestLogFile);
    }

    // Shift log files
    for (let i = this.maxLogFiles - 1; i >= 1; i--) {
      const oldFile = path.join(logDir, `${baseName}.${i}.log`);
      const newFile = path.join(logDir, `${baseName}.${i + 1}.log`);
      if (fs.existsSync(oldFile)) {
        fs.renameSync(oldFile, newFile);
      }
    }

    // Rename current log file
    fs.renameSync(logPath, path.join(logDir, `${baseName}.1.log`));
  }

  /**
   * Append to log file
   */
  private appendToLogFile(content: string) {
    try {
      this.checkLogRotation();
      fs.appendFileSync(this.logFilePath, content);
    } catch (error) {
      // If we can't write to the log file, log to console as a fallback
      console.error('Failed to write to log file:', error);
    }
  }

  /**
   * Append to debug log file
   */
  private appendToDebugLog(content: string) {
    try {
      this.checkLogRotation();
      fs.appendFileSync(this.debugLogPath, content);
    } catch (error) {
      // If we can't write to the debug log file, log to console as a fallback
      console.error('Failed to write to debug log file:', error);
    }
  }

  /**
   * Report error to external monitoring service
   * This is a placeholder for integration with services like Sentry, New Relic, etc.
   */
  private reportToExternalService(logEntry: LogEntry): void {
    const config = this.configService.get<MonitoringConfig>('monitoring');
    if (!config?.externalServices) return;

    // Commenting out to avoid linter error for unused logEntry
    /* 
    if (config.externalServices.sentry?.dsn) {
      // Example Sentry implementation:
      // Sentry.captureException(new Error(logEntry.message), {
      //   extra: {
      //     context: logEntry.context,
      //     additionalInfo: logEntry.additionalInfo,
      //   },
      // });
    }

    if (config.externalServices.datadog?.apiKey) {
      // Example Datadog implementation:
      // const dd = new DatadogTracer({
      //   apiKey: config.externalServices.datadog.apiKey,
      //   appKey: config.externalServices.datadog.appKey,
      // });
      // dd.log.error(logEntry.message, {
      //   service: config.externalServices.datadog.serviceName,
      //   ...logEntry,
      // });
    }
    */

    // Placeholder for external service integration
    // This ensures logEntry is used to avoid linter warning
    if (logEntry && process.env.NODE_ENV === 'development') {
      console.debug(
        'External error reporting would send:',
        logEntry.level,
        logEntry.message,
      );
    }
  }

  /**
   * Get current system information for better debugging context
   */
  private getSystemInfo(): SystemInfo {
    // Update memory and uptime info each time
    return {
      ...this.systemInfo,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    };
  }

  /**
   * Export logs as JSON for debugging
   */
  async exportLogs(days = 1): Promise<string> {
    const logDir = path.dirname(this.logFilePath);
    const allLogs: LogEntry[] = [];

    // Define time threshold (default 1 day)
    const timeThreshold = new Date();
    timeThreshold.setDate(timeThreshold.getDate() - days);

    try {
      // Get all log files
      const logFiles = await fs.promises.readdir(logDir);
      const filteredFiles = logFiles.filter(
        (file) => file.startsWith('error') || file.startsWith('debug'),
      );

      // Read each file
      for (const file of filteredFiles) {
        const filePath = path.join(logDir, file);
        const content = await fs.promises.readFile(filePath, 'utf8');

        // Parse each line as JSON
        const lines = content.split('\n').filter((line) => line.trim());
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as LogEntry;
            const entryDate = new Date(entry.timestamp);

            // Only include logs from the specified time period
            if (entryDate >= timeThreshold) {
              allLogs.push(entry);
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }

      // Sort logs by timestamp
      allLogs.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      return JSON.stringify(allLogs, null, 2);
    } catch (error) {
      console.error('Error exporting logs:', error);
      return JSON.stringify({ error: 'Failed to export logs' });
    }
  }
}
