import { PaginationQueryDto } from './dto/pagination-query.dto';
import { CustomersService } from './customers.service';

describe('Customer list query', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(41);
  const prisma = {
    customer: { findMany, count },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  };
  const service = new CustomersService(prisma as never, {} as never, {} as never);
  beforeEach(() => jest.clearAllMocks());
  it.each(['asc', 'desc'] as const)(
    'combines search and filters with %s sorting',
    async (sortOrder) => {
      const query = Object.assign(new PaginationQueryDto(), {
        page: 2,
        limit: 20,
        search: 'Smith',
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        planId: 'plan',
        state: 'SA',
        postcode: '5000',
        createdFrom: '2026-01-01',
        sortBy: 'lastName',
        sortOrder,
      });
      const result = await service.findAll(query);
      const args = findMany.mock.calls[0][0];
      expect(args).toMatchObject({
        skip: 20,
        take: 20,
        orderBy: [{ lastName: sortOrder }, { id: 'asc' }],
        where: {
          status: 'ACTIVE',
          state: 'SA',
          postcode: '5000',
          subscriptions: { some: { status: 'ACTIVE', planId: 'plan' } },
        },
      });
      expect(args.where.OR).toHaveLength(5);
      expect(count).toHaveBeenCalledWith({ where: args.where });
      expect(result.meta).toMatchObject({ total: 41, hasNextPage: true, page: 2 });
    },
  );
  it.each([
    { status: 'SUSPENDED' },
    { state: 'SA' },
    { postcode: '5000' },
    { createdTo: '2026-09-05' },
    { subscriptionStatus: 'NO_SUBSCRIPTION' },
  ])('supports individual filters %j', async (filter) => {
    await service.findAll(Object.assign(new PaginationQueryDto(), filter));
    expect(findMany.mock.calls[0][0].where).not.toEqual({});
    expect(findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });
});
