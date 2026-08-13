import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';

import type { AppConfig } from '../../config/configuration';
import type { PrismaService } from '../../database/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const user = {
    id: '0b7b51d6-c60b-4e9d-afca-c84e942447aa',
    email: 'admin@merotelecom.test',
    role: 'ADMIN' as const,
    isActive: true,
  };

  const createService = async (passwordHash: string) => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ ...user, passwordHash }),
      },
      refreshSession: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const jwtService = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token'),
      decode: jest.fn().mockReturnValue({ sid: '6d21c29f-34b9-49c8-bff2-ddb48e491aaf' }),
    };
    const configService = {
      getOrThrow: jest.fn().mockReturnValue({
        accessSecret: 'a-development-access-secret-longer-than-thirty-two-characters',
        refreshSecret: 'a-development-refresh-secret-longer-than-thirty-two-characters',
        accessExpiresIn: '15m',
        refreshExpiresIn: '7d',
      }),
    };

    return {
      prisma,
      jwtService,
      service: new AuthService(
        prisma as unknown as PrismaService,
        jwtService as unknown as JwtService,
        configService as unknown as ConfigService<AppConfig, true>,
      ),
    };
  };

  it('issues an access token and persists a hashed refresh session for valid credentials', async () => {
    const passwordHash = await hash('ChangeMe123!', 12);
    const { prisma, service } = await createService(passwordHash);

    const result = await service.login({
      email: 'ADMIN@MEROTELECOM.TEST',
      password: 'ChangeMe123!',
    });

    expect(result).toEqual({
      tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' },
      user: { id: user.id, email: user.email, role: 'ADMIN' },
    });
    expect(prisma.refreshSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: user.id, tokenHash: expect.any(String) }),
      }),
    );
  });

  it('rejects an incorrect password without creating a refresh session', async () => {
    const passwordHash = await hash('ChangeMe123!', 12);
    const { prisma, service } = await createService(passwordHash);

    await expect(
      service.login({ email: user.email, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshSession.create).not.toHaveBeenCalled();
  });
});
