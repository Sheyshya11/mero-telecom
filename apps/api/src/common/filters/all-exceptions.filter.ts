import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode?: number;
  code?: string;
  message?: string | string[];
  error?: string;
  errors?: Record<string, unknown>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = this.createResponseBody(exception, statusCode, request.url);

    response.status(statusCode).json(body);
  }

  private createResponseBody(exception: unknown, statusCode: number, path: string) {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
        errors: {},
        timestamp: new Date().toISOString(),
        path,
      };
    }

    const response = exception.getResponse();
    const error =
      typeof response === 'string' ? { message: response } : (response as ErrorResponseBody);
    const validationMessages = Array.isArray(error.message) ? error.message : undefined;

    return {
      statusCode,
      code: error.code ?? (validationMessages ? 'VALIDATION_ERROR' : this.getErrorCode(statusCode)),
      message: validationMessages ? 'Invalid request.' : (error.message ?? exception.message),
      errors: validationMessages ? { messages: validationMessages } : (error.errors ?? {}),
      timestamp: new Date().toISOString(),
      path,
    };
  }

  private getErrorCode(statusCode: number): string {
    return HttpStatus[statusCode] ?? 'HTTP_ERROR';
  }
}
