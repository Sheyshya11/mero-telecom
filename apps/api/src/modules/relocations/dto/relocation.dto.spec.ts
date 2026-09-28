import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CreateRelocationDto,
  OverrideRelocationDto,
  RelocationOverrideAction,
} from './relocation.dto';

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

describe('relocation address validation', () => {
  const base = {
    qualificationToken: 'q'.repeat(43),
    requestedPlanId: '4ccdfc07-0bac-40e6-93fe-728d00740379',
    requestedMoveDate: '2026-10-28',
  };

  it('accepts the new service address as the billing address', async () => {
    const input = plainToInstance(CreateRelocationDto, {
      ...base,
      billingSameAsService: true,
    });
    await expect(validate(input)).resolves.toHaveLength(0);
  });

  it('requires a trusted billing selection when billing differs from service', async () => {
    const input = plainToInstance(CreateRelocationDto, {
      ...base,
      billingSameAsService: false,
    });
    await expect(validate(input)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'billingAddressSelectionToken' }),
      ]),
    );
  });
});
