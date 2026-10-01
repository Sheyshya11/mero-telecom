import { CustomerStatus, Role, UserStatus } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import { CustomersService } from './customers.service';

const dashboardCache = { invalidate: jest.fn().mockResolvedValue(true) };
const invitations = { issueWithinTransaction: jest.fn(), queueDelivery: jest.fn() };

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

  it('returns the invitation delivery outcome when creating a customer', async () => {
    const transaction = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'customer-user' }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(customer),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...customer,
          user: { status: UserStatus.INVITATION_PENDING, invitations: [] },
          addresses: [],
          subscriptions: [],
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const invitationService = {
      issueWithinTransaction: jest.fn().mockResolvedValue({ invitationId: 'invitation' }),
      queueDelivery: jest.fn().mockResolvedValue(false),
    };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
      invitationService as never,
    );

    const result = await service.create(
      {
        firstName: ' Alex ',
        lastName: ' Taylor ',
        email: 'ALEX@EXAMPLE.TEST',
        phone: '0400000000',
        addressLine1: ' 10 Example Street ',
        suburb: ' Adelaide ',
        state: 'SA',
        postcode: '5000',
      },
      { id: 'admin', email: 'admin@example.test', role: Role.ADMIN, roles: [Role.ADMIN] },
    );

    expect(result.invitationQueued).toBe(false);
    expect(transaction.customer.create.mock.calls[0][0].data).toMatchObject({
      firstName: 'Alex',
      lastName: 'Taylor',
      addressLine1: '10 Example Street',
      suburb: 'Adelaide',
    });
  });

  it('limits staff updates to approved contact and address fields', async () => {
    const customerRepository = {
      findUnique: jest.fn().mockResolvedValue(customer),
      update: jest.fn().mockResolvedValue({ ...customer, phone: '+61400000009' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...customer, phone: '+61400000009' }),
    };
    const transaction = { customer: customerRepository };
    const prisma = {
      ...transaction,
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
      invitations as never,
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
    const customerRepository = {
      findUnique: jest.fn().mockResolvedValue(customer),
      update: jest.fn().mockResolvedValue({ ...customer, status: 'SUSPENDED' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...customer, status: 'SUSPENDED' }),
    };
    const transaction = { customer: customerRepository };
    const prisma = {
      ...transaction,
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
      invitations as never,
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
      invitations as never,
    );

    const result = await service.findAll({ page: 1, limit: 20 });

    expect(result.data[0]?.currentSubscription).toEqual(currentSubscription);
  });

  it('loads current subscription data for an individual customer response', async () => {
    const currentSubscription = {
      status: 'PAST_DUE' as const,
      plan: { id: 'plan-id', name: 'Essential 50' },
    };
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          ...customer,
          subscriptions: [currentSubscription],
          addresses: [],
        }),
      },
    };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
      invitations as never,
    );

    await expect(service.findOne(customer.id)).resolves.toEqual(
      expect.objectContaining({ currentSubscription }),
    );
    expect(
      prisma.customer.findUnique.mock.calls[0][0].include.subscriptions.where.status.in,
    ).toEqual(expect.arrayContaining(['ACTIVE', 'PAST_DUE', 'PENDING']));
  });

  it('keeps customer and login status aligned and revokes sessions on suspension', async () => {
    const linkedCustomer = {
      ...customer,
      user: {
        id: 'customer-user',
        status: UserStatus.ACTIVE,
        passwordHash: 'hash',
        emailVerifiedAt: new Date(),
      },
    };
    const transaction = {
      customer: {
        update: jest.fn().mockResolvedValue({ ...customer, status: CustomerStatus.SUSPENDED }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...customer,
          status: CustomerStatus.SUSPENDED,
          user: { status: UserStatus.SUSPENDED, invitations: [] },
          addresses: [],
          subscriptions: [],
        }),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
      refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue(linkedCustomer) },
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
      invitations as never,
    );

    await service.update(
      customer.id,
      { id: 'admin-id', email: 'admin@example.test', role: Role.ADMIN, roles: [Role.ADMIN] },
      { status: CustomerStatus.SUSPENDED },
    );

    expect(transaction.customer.update).toHaveBeenCalledWith({
      where: { id: customer.id },
      data: expect.objectContaining({ status: CustomerStatus.SUSPENDED }),
    });
    expect(transaction.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: linkedCustomer.user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('does not mark an unverified invited customer active', async () => {
    const transaction = {
      customer: {
        update: jest.fn().mockResolvedValue(customer),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...customer, addresses: [], subscriptions: [] }),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
      refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          ...customer,
          status: CustomerStatus.INVITATION_PENDING,
          user: {
            id: 'customer-user',
            status: UserStatus.INVITATION_PENDING,
            passwordHash: null,
            emailVerifiedAt: null,
          },
        }),
      },
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
      invitations as never,
    );

    await service.update(
      customer.id,
      { id: 'admin-id', email: 'admin@example.test', role: Role.ADMIN, roles: [Role.ADMIN] },
      { status: CustomerStatus.ACTIVE },
    );

    expect(transaction.customer.update.mock.calls[0][0].data.status).toBe(
      CustomerStatus.INVITATION_PENDING,
    );
  });

  it('updates the contact and billing address without changing the service address', async () => {
    const billingAddress = {
      addressLine1: '1 Old Service Road',
      addressLine2: null,
      suburb: 'Adelaide',
      state: 'SA',
      postcode: '5000',
    };
    const transaction = {
      customer: {
        update: jest.fn().mockResolvedValue(customer),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...customer,
          addresses: [{ ...billingAddress, type: 'BILLING', addressLine1: '2 New Service Road' }],
          subscriptions: [],
        }),
      },
      customerAddress: { upsert: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'profile-audit-id' }) },
    };
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ ...customer, addresses: [billingAddress] }),
      },
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const notifications = { sendProfileUpdated: jest.fn().mockResolvedValue(undefined) };
    const service = new CustomersService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
      invitations as never,
      notifications as never,
    );

    await service.updateOwn('customer-user', { addressLine1: ' 2 New Service Road ', state: 'sa' });

    expect(transaction.customer.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        phone: undefined,
        addressLine1: ' 2 New Service Road ',
        state: 'SA',
      }),
    );
    expect(transaction.customerAddress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          customerId_type: { customerId: customer.id, type: 'BILLING' },
        },
        update: expect.objectContaining({
          type: 'BILLING',
          addressLine1: '2 New Service Road',
          state: 'SA',
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'customer-user',
        action: 'PROFILE_UPDATED',
        metadata: { changedFields: ['contactAddress'] },
      }),
      select: { id: true },
    });
    expect(notifications.sendProfileUpdated).toHaveBeenCalledWith({
      userId: 'customer-user',
      eventId: 'profile-audit-id',
    });
  });
});
