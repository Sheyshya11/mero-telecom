import { CancellationReason, CancellationType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CancellationQueryDto, CreateCancellationDto } from './cancellation.dto';

describe('cancellation DTOs', () => {
  it('accepts both the cancellation default and the shared legacy table sort', async () => {
    await expect(
      validate(plainToInstance(CancellationQueryDto, { sortBy: 'requestedAt' })),
    ).resolves.toHaveLength(0);
    await expect(
      validate(plainToInstance(CancellationQueryDto, { sortBy: 'createdAt' })),
    ).resolves.toHaveLength(0);
  });

  it('requires meaningful details when Other is selected', async () => {
    const input = plainToInstance(CreateCancellationDto, {
      type: CancellationType.END_OF_PERIOD,
      reason: CancellationReason.OTHER,
      confirmed: true,
    });

    const errors = await validate(input);

    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'reasonDetails' })]),
    );
  });

  it('does not require details for a predefined reason', async () => {
    const input = plainToInstance(CreateCancellationDto, {
      type: CancellationType.END_OF_PERIOD,
      reason: CancellationReason.MOVING_HOME,
      confirmed: true,
    });

    await expect(validate(input)).resolves.toHaveLength(0);
  });
});
