import { BadRequestException } from '@nestjs/common';

import { createValidationPipe } from '../../../common/pipes/create-validation-pipe';
import { CreatePlanDto, UpdatePlanDto, UpdatePlanHighlightsDto } from './plan.dto';

describe('plan DTO validation', () => {
  const pipe = createValidationPipe();

  it('trims valid catalogue text at the HTTP boundary', async () => {
    await expect(
      pipe.transform(
        {
          name: '  Essential 50  ',
          highlights: ['  HD streaming  '],
          downloadMbps: 50,
          uploadMbps: 20,
          monthlyCents: 6900,
        },
        { type: 'body', metatype: CreatePlanDto },
      ),
    ).resolves.toMatchObject({ name: 'Essential 50', highlights: ['HD streaming'] });
  });

  it.each([
    { name: '  ', downloadMbps: 50, uploadMbps: 20, monthlyCents: 6900 },
    { name: 'Plan', downloadMbps: 2_147_483_647, uploadMbps: 20, monthlyCents: 6900 },
    { name: 'Plan', downloadMbps: 50, uploadMbps: 20, monthlyCents: 2_147_483_647 },
    {
      name: 'Plan',
      highlights: ['Same', ' Same '],
      downloadMbps: 50,
      uploadMbps: 20,
      monthlyCents: 6900,
    },
  ])('rejects invalid create input %#', async (input) => {
    await expect(
      pipe.transform(input, { type: 'body', metatype: CreatePlanDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires an optimistic concurrency timestamp for plan edits', async () => {
    await expect(
      pipe.transform({ monthlyCents: 7900 }, { type: 'body', metatype: UpdatePlanDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate normalized highlights', async () => {
    await expect(
      pipe.transform(
        {
          expectedUpdatedAt: '2026-09-13T12:00:00.000Z',
          highlights: ['Streaming', ' Streaming '],
        },
        { type: 'body', metatype: UpdatePlanHighlightsDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
