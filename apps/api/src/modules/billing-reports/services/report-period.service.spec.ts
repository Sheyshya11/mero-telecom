import { BadRequestException } from '@nestjs/common';

import { ReportingPeriodPreset } from '../dto/billing-report-query.dto';
import { ReportPeriodService } from './report-period.service';

describe('ReportPeriodService', () => {
  const service = new ReportPeriodService({
    get: () => ({ timezone: 'Australia/Adelaide' }),
  } as never);

  it('uses Adelaide local midnight across the daylight-saving boundary', () => {
    const result = service.resolve(
      {
        preset: ReportingPeriodPreset.CUSTOM,
        from: '2026-10-04',
        to: '2026-10-04',
        timezone: 'Australia/Adelaide',
        page: 1,
        pageSize: 25,
        sortBy: 'date',
        sortDirection: 'desc',
      },
      new Date('2026-10-04T12:00:00.000Z'),
    );
    expect(result.from.toISOString()).toBe('2026-10-03T14:30:00.000Z');
    expect(result.to.toISOString()).toBe('2026-10-04T13:30:00.000Z');
  });

  it('uses 1 July as the Australian financial-year boundary', () => {
    const result = service.resolve(
      {
        preset: ReportingPeriodPreset.THIS_FINANCIAL_YEAR,
        page: 1,
        pageSize: 25,
        sortBy: 'date',
        sortDirection: 'desc',
      },
      new Date('2026-05-10T02:00:00.000Z'),
    );
    expect(result.fromLocalDate).toBe('2025-07-01');
    expect(result.toLocalDate).toBe('2026-05-10');
  });

  it('rejects invalid IANA timezones', () => {
    expect(() =>
      service.resolve({
        timezone: 'Not/AZone',
        page: 1,
        pageSize: 25,
        sortBy: 'date',
        sortDirection: 'desc',
      }),
    ).toThrow(BadRequestException);
  });
});
