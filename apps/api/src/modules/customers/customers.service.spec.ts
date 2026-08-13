import { Role } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import { CustomersService } from './customers.service';

const dashboardCache = { invalidate: jest.fn().mockResolvedValue(true) };

describe('CustomersService', () => {
  const customer = {
    id: '28131c05-662d-405e-b2ef-64e374120eff',
    customerNumber: 'CUST-000001',
    firstName: 'Anika',
    lastName: 'Singh',
    email: 'customer@merotelecom.test',
    phone: '+61400000001',
    addressLine1: '15 Harbour Street',
    addressLine2: null,
    suburb: 'Sydney',
    state: 'NSW',
    postcode: '2000',
    status: 'ACTIVE' as const,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  it('limits staff updates to approved contact and address fields', async () => {
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(customer),
        update: jest.fn().mockResolvedValue({ ...customer, phone: '+61400000009' }),
      },
    };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
    );

    await service.update(
      customer.id,
      { id: 'staff-id', email: 'staff@merotelecom.test', role: Role.STAFF },
      { firstName: 'Changed', phone: '+61400000009', status: 'SUSPENDED' },
    );

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: customer.id },
      data: expect.objectContaining({ phone: '+61400000009' }),
    });
    expect(prisma.customer.update.mock.calls[0][0].data).not.toHaveProperty('firstName');
    expect(prisma.customer.update.mock.calls[0][0].data).not.toHaveProperty('status');
  });

  it('allows an admin to update account status', async () => {
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(customer),
        update: jest.fn().mockResolvedValue({ ...customer, status: 'SUSPENDED' }),
      },
    };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
    );

    await service.update(
      customer.id,
      { id: 'admin-id', email: 'admin@merotelecom.test', role: Role.ADMIN },
      { status: 'SUSPENDED' },
    );

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: customer.id },
      data: { status: 'SUSPENDED', email: undefined, state: undefined },
    });
  });

  it('includes the current subscription in the paginated customer response', async () => {
    const currentSubscription = {
      status: 'ACTIVE' as const,
      plan: { id: 'plan-id', name: 'Essential 50' },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockResolvedValue([[{ ...customer, subscriptions: [currentSubscription] }], 1]),
      customer: { findMany: jest.fn(), count: jest.fn() },
    };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
    );

    const result = await service.findAll({ page: 1, limit: 20 });

    expect(result.data[0]?.currentSubscription).toEqual(currentSubscription);
  });
});
