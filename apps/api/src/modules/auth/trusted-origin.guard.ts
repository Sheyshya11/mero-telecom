import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { AppConfig } from '../../config/configuration';

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().headers.origin;

    // Non-browser clients may omit Origin. Browsers include it for these cross-origin POSTs.
    if (!origin) return true;

    const trustedOrigin = new URL(this.configService.getOrThrow('app').frontendUrl).origin;
    let requestOrigin: string;
    try {
      requestOrigin = new URL(origin).origin;
    } catch {
      throw new ForbiddenException('Request origin is not trusted.');
    }

    if (requestOrigin !== trustedOrigin) {
      throw new ForbiddenException('Request origin is not trusted.');
    }

    return true;
  }
}
