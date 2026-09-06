import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto } from '../modules/customers/dto/pagination-query.dto';
import { amountRange, buildPaginationMeta, dateRange } from './pagination';

describe('Customer list validation and pagination', () => {
  it('uses bounded defaults', async () => {
    const query = plainToInstance(PaginationQueryDto, {});
    expect(query).toMatchObject({ page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' });
    expect(await validate(query)).toHaveLength(0);
  });
  it.each([
    { page: 0 },
    { page: 1.5 },
    { limit: 25 },
    { limit: 101 },
    { sortBy: 'passwordHash' },
    { sortOrder: 'invalid' },
    { status: 'PENDING' },
    { subscriptionStatus: 'FAKE' },
    { createdFrom: '2026-02-30' },
    { planId: 'invalid' },
  ])('rejects invalid query %j', async (input) => {
    expect((await validate(plainToInstance(PaginationQueryDto, input))).length).toBeGreaterThan(0);
  });
  it.each([10, 20, 50, 100])('accepts page size %i', async (limit) => {
    expect(
      await validate(
        plainToInstance(PaginationQueryDto, {
          page: '2',
          limit: String(limit),
          sortOrder: 'asc',
          status: 'ACTIVE',
          state: 'SA',
        }),
      ),
    ).toHaveLength(0);
  });
  it('handles empty and final pages', () => {
    expect(buildPaginationMeta({ page: 1, limit: 20 }, 0)).toMatchObject({
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    expect(buildPaginationMeta({ page: 3, limit: 20 }, 41)).toMatchObject({
      totalPages: 3,
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });
  it('includes the entire end date and rejects reversed ranges', () => {
    expect(dateRange(undefined, '2026-09-05')?.lte?.toISOString()).toBe('2026-09-05T23:59:59.999Z');
    expect(() => dateRange('2026-09-06', '2026-09-05')).toThrow();
    expect(() => amountRange(200, 100)).toThrow();
  });
});
