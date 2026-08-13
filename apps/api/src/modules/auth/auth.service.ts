import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Prisma, User } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { randomUUID } from 'crypto';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import type {
  AccessTokenPayload,
  AuthenticatedUser,
  AuthTokens,
  RefreshTokenPayload,
} from './auth.types';
import type { LoginDto } from './dto/login.dto';

type SessionClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async login(loginDto: LoginDto): Promise<{ tokens: AuthTokens; user: AuthenticatedUser }> {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email.toLowerCase() },
    });

    if (!user || !user.isActive || !(await compare(loginDto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const tokens = await this.createTokens(user);
    await this.createRefreshSession(this.prisma, user.id, tokens.refreshToken);

    return { tokens, user: this.toAuthenticatedUser(user) };
  }

  async refresh(refreshToken: string): Promise<{ tokens: AuthTokens; user: AuthenticatedUser }> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      !session.user.isActive ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !(await compare(refreshToken, session.tokenHash))
    ) {
      throw new UnauthorizedException('Refresh session is invalid or expired.');
    }

    const tokens = await this.createTokens(session.user);

    await this.prisma.$transaction(async (transaction) => {
      const revokedSession = await transaction.refreshSession.updateMany({
        where: {
          id: session.id,
          userId: session.userId,
          tokenHash: session.tokenHash,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      if (revokedSession.count !== 1) {
        throw new UnauthorizedException('Refresh session has already been used.');
      }

      await this.createRefreshSession(transaction, session.userId, tokens.refreshToken);
    });

    return { tokens, user: this.toAuthenticatedUser(session.user) };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.configService.getOrThrow('jwt').refreshSecret,
        ignoreExpiration: true,
      });

      if (payload.type === 'refresh' && payload.sub && payload.sid) {
        await this.prisma.refreshSession.updateMany({
          where: { id: payload.sid, userId: payload.sub, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } catch {
      // Logout is intentionally idempotent: the cookie will still be cleared by the controller.
    }
  }

  async getAuthenticatedUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User account is unavailable.');
    }

    return user;
  }

  getRefreshTokenLifetimeMilliseconds(): number {
    return this.parseDuration(this.configService.getOrThrow('jwt').refreshExpiresIn);
  }

  private async createTokens(user: User): Promise<AuthTokens> {
    const jwtConfig = this.configService.getOrThrow('jwt');
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      sid: randomUUID(),
      type: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: jwtConfig.accessSecret,
        expiresIn: this.parseDuration(jwtConfig.accessExpiresIn) / 1000,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: jwtConfig.refreshSecret,
        expiresIn: this.parseDuration(jwtConfig.refreshExpiresIn) / 1000,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async createRefreshSession(
    client: SessionClient,
    userId: string,
    refreshToken: string,
  ): Promise<void> {
    const payload = this.jwtService.decode(refreshToken) as RefreshTokenPayload | null;

    if (!payload?.sid) {
      throw new UnauthorizedException('Unable to create refresh session.');
    }

    await client.refreshSession.create({
      data: {
        id: payload.sid,
        userId,
        tokenHash: await hash(refreshToken, 12),
        expiresAt: new Date(Date.now() + this.getRefreshTokenLifetimeMilliseconds()),
      },
    });
  }

  private async verifyRefreshToken(refreshToken: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.configService.getOrThrow('jwt').refreshSecret,
      });

      if (payload.type !== 'refresh' || !payload.sub || !payload.sid) {
        throw new UnauthorizedException('Refresh token is invalid.');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
  }

  private parseDuration(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value);

    if (!match) {
      throw new Error(`Unsupported JWT duration: ${value}`);
    }

    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];

    if (multiplier === undefined) {
      throw new Error(`Unsupported JWT duration unit: ${unit}`);
    }

    return amount * multiplier;
  }

  private toAuthenticatedUser(user: Pick<User, 'id' | 'email' | 'role'>): AuthenticatedUser {
    return { id: user.id, email: user.email, role: user.role };
  }
}
