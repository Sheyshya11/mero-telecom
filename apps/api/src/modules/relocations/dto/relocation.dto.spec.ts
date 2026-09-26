import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { OverrideRelocationDto, RelocationOverrideAction } from './relocation.dto';

describe('relocation override validation', () => {
  it('rejects an override without a meaningful reason', async () => {
    const input = plainToInstance(OverrideRelocationDto, {
      action: RelocationOverrideAction.MARK_NEW_SERVICE_ACTIVE,
      reason: '   ',
    });
    await expect(validate(input)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'reason' })]),
    );
  });

  it('accepts a meaningful Super Admin override reason payload', async () => {
    const input = plainToInstance(OverrideRelocationDto, {
      action: RelocationOverrideAction.MARK_NEW_SERVICE_ACTIVE,
      reason: 'Provider manually confirmed activation.',
    });
    await expect(validate(input)).resolves.toHaveLength(0);
  });
});
