import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ErrorLoggingService } from './error-logging.service';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(private readonly errorLoggingService: ErrorLoggingService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';

    // Create the log info object
    const logInfo = {
      method,
      originalUrl,
      ip,
      userAgent,
    };

    // Log the request start
    this.errorLoggingService.logInfo(
      `Request started: ${method} ${originalUrl}`,
      'HTTP',
      logInfo,
    );

    // Track response
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      const responseInfo = {
        ...logInfo,
        statusCode,
        duration: `${duration}ms`,
      };

      if (statusCode >= 500) {
        // Log server errors
        this.errorLoggingService.logError(
          new Error(`Server error ${statusCode} on ${method} ${originalUrl}`),
          'HTTP',
          responseInfo,
        );
      } else if (statusCode >= 400) {
        // Log client errors
        this.errorLoggingService.logWarning(
          `Client error ${statusCode} on ${method} ${originalUrl}`,
          'HTTP',
          responseInfo,
        );
      } else {
        // Log successful requests
        this.errorLoggingService.logInfo(
          `Request completed: ${method} ${originalUrl} - ${statusCode} in ${duration}ms`,
          'HTTP',
          responseInfo,
        );
      }
    });

    next();
  }
}
