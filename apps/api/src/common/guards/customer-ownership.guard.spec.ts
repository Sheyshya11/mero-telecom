import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { PrismaService } from '../../database/prisma.service';
import { CustomerOwnershipGuard } from './customer-ownership.guard';

describe('CustomerOwnershipGuard', () => {
  const customerId = '5a88a812-bf0e-4548-9789-1d5d29af0c22';
  const userId = '0b7b51d6-c60b-4e9d-afca-c84e942447aa';

  const createContext = (role: 'ADMIN' | 'STAFF' | 'CUSTOMER', id = customerId) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          params: { customerId: id },
          user: { id: userId, role },
        }),
      }),
    }) as never;

  const createGuard = (customer: { id: string } | null) => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('customerId') };
    const prisma = { customer: { findFirst: jest.fn().mockResolvedValue(customer) } };

    return {
      prisma,
      guard: new CustomerOwnershipGuard(
        reflector as unknown as Reflector,
        prisma as unknown as PrismaService,
      ),
    };
  };

  it('allows a customer to access their own customer resource', async () => {
    const { prisma, guard } = createGuard({ id: customerId });

    await expect(guard.canActivate(createContext('CUSTOMER'))).resolves.toBe(true);
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { id: customerId, userId },
      select: { id: true },
    });
  });

  it('rejects a customer attempting to access another customer resource', async () => {
    const { guard } = createGuard(null);

    await expect(guard.canActivate(createContext('CUSTOMER'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows staff to access customer resources without an ownership query', async () => {
    const { prisma, guard } = createGuard(null);

    await expect(guard.canActivate(createContext('STAFF'))).resolves.toBe(true);
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a malformed customer ID before querying ownership', async () => {
    const { prisma, guard } = createGuard(null);

    await expect(guard.canActivate(createContext('CUSTOMER', 'not-a-uuid'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });
});
