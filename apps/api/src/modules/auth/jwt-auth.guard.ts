import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AppConfig } from '../../config/configuration';
import type { AccessTokenPayload, AuthenticatedRequest } from './auth.types';
import { AuthService } from './auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.configService.getOrThrow('jwt').accessSecret,
      });

      if (payload.type !== 'access' || !payload.sub) {
        throw new UnauthorizedException('Access token is invalid.');
      }

      request.user = await this.authService.getAuthenticatedUser(payload.sub);
      return true;
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired.');
    }
  }

  private extractBearerToken(authorization: string | undefined): string {
    if (!authorization) {
      throw new UnauthorizedException('Access token is required.');
    }

    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Access token is required.');
    }

    return token;
  }
}
