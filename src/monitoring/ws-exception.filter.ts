import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { ErrorLoggingService } from './error-logging.service';

@Catch()
export class WebSocketExceptionFilter implements ExceptionFilter {
  constructor(private readonly errorLoggingService: ErrorLoggingService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();

    // Determine error code and message
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof WsException) {
      status = HttpStatus.BAD_REQUEST;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
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

    // Log the exception with context
    this.errorLoggingService.logError(
      exception instanceof Error ? exception : new Error(String(exception)),
      'WebSocket',
      {
        clientId: client.id,
        handshake: client.handshake,
        rooms: [...client.rooms],
        status,
      },
    );

    // Send error to client
    client.emit('error', {
      status,
      timestamp: new Date().toISOString(),
      message,
    });
  }
}
