import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '@prisma/client';
import { SubscriptionQueryDto } from '../modules/subscriptions/dto/subscription.dto';
import { InvoiceQueryDto } from '../modules/invoices/dto/invoice.dto';
import { RefundQueryDto } from '../modules/refunds/dto/refund.dto';
import {
  SystemUserQueryDto,
  SecurityAuditQueryDto,
} from '../modules/system-users/dto/system-user.dto';
import { SubscriptionsService } from '../modules/subscriptions/subscriptions.service';
import { InvoicesService } from '../modules/invoices/invoices.service';
import { RefundsService } from '../modules/refunds/refunds.service';
import { SystemUsersService } from '../modules/system-users/system-users.service';
import { createValidationPipe } from './pipes/create-validation-pipe';

const actor = { id: 'actor', role: Role.SUPER_ADMIN, email: 'test@example.test' };
function repository() {
  return { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(25) };
}
function database() {
  return {
    subscription: repository(),
    invoice: repository(),
    refund: repository(),
    user: repository(),
    auditLog: repository(),
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  };
}

describe('Admin list validation', () => {
  for (const dto of [
    SubscriptionQueryDto,
    InvoiceQueryDto,
    RefundQueryDto,
    SystemUserQueryDto,
    SecurityAuditQueryDto,
  ]) {
    describe(dto.name, () => {
      it.each([
        { page: -1 },
        { limit: 0 },
        { limit: 25 },
        { sortBy: 'secret' },
        { sortOrder: 'invalid' },
      ])('rejects %j', async (input) => {
        const instance = plainToInstance(dto as new () => object, input);
        expect((await validate(instance)).length).toBeGreaterThan(0);
      });
      it('transforms valid query strings and rejects unknown fields at the HTTP boundary', async () => {
        const pipe = createValidationPipe();
        const metadata = { type: 'query' as const, metatype: dto };
        await expect(pipe.transform({ page: '2', limit: '50' }, metadata)).resolves.toMatchObject({
          page: 2,
          limit: 50,
        });
        await expect(pipe.transform({ arbitraryField: 'x' }, metadata)).rejects.toMatchObject({
          status: 400,
        });
      });
    });
  }
  it.each([
    [SubscriptionQueryDto, { status: 'UNKNOWN_STATUS' }],
    [InvoiceQueryDto, { status: 'unknown' }],
    [RefundQueryDto, { reason: 'unknown' }],
    [SystemUserQueryDto, { role: 'OWNER' }],
    [SecurityAuditQueryDto, { actorRole: 'OWNER' }],
    [InvoiceQueryDto, { minAmount: -1 }],
    [RefundQueryDto, { dateTo: '2026-02-30' }],
  ])('rejects invalid domain values', async (dto, input) => {
    expect(
      (await validate(plainToInstance(dto as new () => object, input))).length,
    ).toBeGreaterThan(0);
  });
});

describe('Admin list database filters', () => {
  it('combines subscription filters in one paginated query', async () => {
    const db = database();
    const service = new SubscriptionsService(db as never, {} as never);
    await service.findAll(
      Object.assign(new SubscriptionQueryDto(), {
        page: 2,
        status: 'ACTIVE',
        search: 'Smith',
        planId: 'plan',
        billingCycle: 'MONTHLY',
        paymentStatus: 'SUCCEEDED',
        pendingPlanChange: 'false',
        cancelled: 'false',
        activatedFrom: '2026-01-01',
        sortBy: 'startDate',
        sortOrder: 'asc',
      }),
    );
    const args = db.subscription.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      where: {
        status: 'ACTIVE',
        planId: 'plan',
        billingCycle: 'MONTHLY',
        invoices: { some: { payments: { some: { status: 'SUCCEEDED' } } } },
        sourcePlanChanges: { none: expect.any(Object) },
      },
    });
    expect(db.subscription.count).toHaveBeenCalledWith({ where: args.where });
  });
  it('preserves customer invoice ownership with search and financial filters', async () => {
    const db = database();
    const service = new InvoicesService(db as never, {} as never, {} as never, {} as never);
    await service.findAll(
      Object.assign(new InvoiceQueryDto(), {
        customerId: 'someone-else',
        search: 'Smith',
        status: 'REFUNDED',
        dateFrom: '2026-01-01',
        minAmount: 100,
        maxAmount: 200,
      }),
      { ...actor, role: Role.CUSTOMER },
    );
    const args = db.invoice.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      customer: { userId: 'actor' },
      totalCents: { gte: 100, lte: 200 },
    });
    expect(args.where.customerId).toBeUndefined();
    expect(args.where.AND[0]).toEqual({ payments: { some: { status: 'REFUNDED' } } });
    expect(db.invoice.count).toHaveBeenCalledWith({ where: args.where });
  });
  it('combines refund amount, reason, provider search, date and status', async () => {
    const db = database();
    const service = new RefundsService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.findAll(
      Object.assign(new RefundQueryDto(), {
        status: 'SUCCEEDED',
        reason: 'OTHER',
        search: 're_test',
        minAmount: 0,
        maxAmount: 5000,
        dateTo: '2026-09-05',
        sortOrder: 'asc',
      }),
    );
    const args = db.refund.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      status: 'SUCCEEDED',
      reason: 'OTHER',
      refundAmountCents: { gte: 0, lte: 5000 },
      requestedAt: { lte: new Date('2026-09-05T23:59:59.999Z') },
    });
    expect(args.where.OR).toContainEqual({
      stripeRefundId: { contains: 're_test', mode: 'insensitive' },
    });
  });
  it('checks policies before user/audit queries and preserves their combined filters', async () => {
    const db = database();
    const policy = { assertCanReadUsers: jest.fn(), assertCanReadSecurityAudit: jest.fn() };
    const service = new SystemUsersService(db as never, policy as never);
    const users = await service.list(
      Object.assign(new SystemUserQueryDto(), {
        role: 'STAFF',
        status: 'ACTIVE',
        active: 'true',
        createdFrom: '2026-01-01',
        search: 'Smith',
      }),
      actor,
    );
    expect(policy.assertCanReadUsers).toHaveBeenCalledWith(actor);
    expect(db.user.findMany.mock.calls[0][0].where).toMatchObject({
      roles: { some: { role: 'STAFF' } },
      status: 'ACTIVE',
      isActive: true,
    });
    expect(users.meta.activeSuperAdminCount).toBe(25);
    await service.listAuditLogs(
      Object.assign(new SecurityAuditQueryDto(), {
        actorRole: 'ADMIN',
        actorUserId: 'actor',
        entityId: 'resource',
        action: 'READ',
        dateFrom: '2026-01-01',
        search: 'Smith',
      }),
      actor,
    );
    expect(policy.assertCanReadSecurityAudit).toHaveBeenCalledWith(actor);
    expect(db.auditLog.findMany.mock.calls[0][0]).toMatchObject({
      take: 20,
      where: {
        actor: { roles: { some: { role: 'ADMIN' } } },
        actorUserId: 'actor',
        entityId: 'resource',
        action: 'READ',
      },
    });
    policy.assertCanReadSecurityAudit.mockImplementation(() => {
      throw new Error('Forbidden');
    });
    await expect(service.listAuditLogs(new SecurityAuditQueryDto(), actor)).rejects.toThrow(
      'Forbidden',
    );
    expect(db.auditLog.findMany).toHaveBeenCalledTimes(1);
  });
});
