import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';

import type { AuthenticatedUser } from '../../modules/auth/auth.types';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const requestId = this.requestId(request.header('x-request-id'));
    const startedAt = performance.now();
    let statusCode = response.statusCode;

    response.setHeader('X-Request-ID', requestId);

    return next.handle().pipe(
      tap({
        error: (error: unknown) => {
          statusCode = error instanceof HttpException ? error.getStatus() : 500;
        },
      }),
      finalize(() => {
        this.logger.log(
          JSON.stringify({
            event: 'http_request_completed',
            requestId,
            method: request.method,
            path: request.originalUrl.split('?')[0],
            statusCode,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            userId: request.user?.id,
          }),
        );
      }),
    );
  }

  private requestId(value: string | undefined): string {
    return value && /^[A-Za-z0-9._:-]{8,100}$/.test(value) ? value : randomUUID();
  }
}
