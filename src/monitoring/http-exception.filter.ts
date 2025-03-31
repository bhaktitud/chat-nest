import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorLoggingService } from './error-logging.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly errorLoggingService: ErrorLoggingService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Determine HTTP status code
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
    }

    // Extract the request path and basic details
    const method = request.method;
    const originalUrl = request.originalUrl;
    const ip = request.ip;
    const headers = request.headers;
    const params = request.params;
    const query = request.query;
    const body = request.body;

    // Sanitize the request body to exclude sensitive information
    const sanitizedBody: Record<string, unknown> = {};
    if (body && typeof body === 'object') {
      Object.keys(body as Record<string, unknown>).forEach((key) => {
        // Skip sensitive fields like passwords
        if (
          !['password', 'token', 'auth', 'secret', 'apiKey'].includes(
            key.toLowerCase(),
          )
        ) {
          sanitizedBody[key] = (body as Record<string, unknown>)[key];
        }
      });
    }

    // Log the exception with contextual information
    this.errorLoggingService.logError(
      exception instanceof Error ? exception : new Error(String(exception)),
      'HTTP',
      {
        statusCode: status,
        path: originalUrl,
        method,
        ip,
        headers,
        params,
        query,
        body: sanitizedBody,
      },
    );

    // Determine the error message to return to the client
    let message = 'Internal server error';
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      message =
        typeof response === 'object' && 'message' in response
          ? (response as { message: string }).message
          : typeof response === 'string'
            ? response
            : 'Error';
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Send a consistent error response
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}
