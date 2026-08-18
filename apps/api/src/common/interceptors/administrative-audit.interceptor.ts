import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../modules/auth/auth.types';

type AuditedRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class AdministrativeAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdministrativeAuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<AuditedRequest>();
    const actor = request.user;
    if (
      !actor ||
      (actor.role !== Role.ADMIN && actor.role !== Role.STAFF) ||
      ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      mergeMap(async (result: unknown) => {
        const path = request.originalUrl.split('?')[0];
        const resource = path.split('/').filter(Boolean).at(2) ?? 'operation';
        const resultId = this.resultId(result);
        const parameterId = Object.values(request.params).find(
          (value) => typeof value === 'string',
        );
        try {
          await this.prisma.auditLog.create({
            data: {
              actorUserId: actor.id,
              action: `${request.method}_${resource}`.toUpperCase(),
              entityType: this.entityType(resource),
              entityId: resultId ?? parameterId ?? 'collection',
              metadata: { method: request.method, path },
            },
          });
        } catch (error) {
          this.logger.error(
            JSON.stringify({
              event: 'administrative_audit_failed',
              actorUserId: actor.id,
              method: request.method,
              path,
              error: error instanceof Error ? error.name : 'UnknownError',
            }),
          );
        }
        return result;
      }),
    );
  }

  private resultId(result: unknown): string | undefined {
    if (typeof result !== 'object' || result === null || !('id' in result)) return undefined;
    return typeof result.id === 'string' ? result.id : undefined;
  }

  private entityType(resource: string): string {
    const singular = resource.endsWith('ies')
      ? `${resource.slice(0, -3)}y`
      : resource.endsWith('s')
        ? resource.slice(0, -1)
        : resource;
    return singular.charAt(0).toUpperCase() + singular.slice(1);
  }
}
