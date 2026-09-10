import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const createContext = (role: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'CUSTOMER', roles = [role]) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role, roles } }),
      }),
    }) as never;

  it('allows an admin assigned to an admin-only route', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    await expect(guard.canActivate(createContext('ADMIN'))).resolves.toBe(true);
  });

  it('rejects staff from an admin-only route', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    await expect(guard.canActivate(createContext('STAFF'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('explicitly allows a super admin to inherit an admin route', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    await expect(guard.canActivate(createContext('SUPER_ADMIN'))).resolves.toBe(true);
  });

  it('allows all authenticated roles when no role metadata is defined', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    await expect(guard.canActivate(createContext('CUSTOMER'))).resolves.toBe(true);
  });

  it('allows a multi-role account when any assigned role is permitted', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['CUSTOMER']),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    await expect(guard.canActivate(createContext('STAFF', ['CUSTOMER', 'STAFF']))).resolves.toBe(
      true,
    );
  });
});
