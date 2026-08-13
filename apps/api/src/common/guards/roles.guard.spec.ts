import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const createContext = (role: 'ADMIN' | 'STAFF' | 'CUSTOMER') =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    }) as never;

  it('allows an admin assigned to an admin-only route', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(createContext('ADMIN'))).toBe(true);
  });

  it('rejects staff from an admin-only route', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(() => guard.canActivate(createContext('STAFF'))).toThrow(ForbiddenException);
  });

  it('allows all authenticated roles when no role metadata is defined', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(createContext('CUSTOMER'))).toBe(true);
  });
});
