import { BadRequestException } from '@nestjs/common';

import { createValidationPipe } from '../../../common/pipes/create-validation-pipe';
import { UpdateOwnCustomerDto } from './update-customer.dto';

describe('customer self-service profile validation', () => {
  const pipe = createValidationPipe();
  const metadata = { type: 'body' as const, metatype: UpdateOwnCustomerDto };

  it('accepts name edits and normalizes common phone separators', async () => {
    await expect(
      pipe.transform(
        { firstName: ' Sam ', lastName: ' Lee ', phone: '+61 (400) 000-000' },
        metadata,
      ),
    ).resolves.toMatchObject({ firstName: 'Sam', lastName: 'Lee', phone: '+61400000000' });
  });
  it.each([
    { firstName: '   ' },
    { lastName: '' },
    { firstName: null },
    { firstName: 'a'.repeat(101) },
    { phone: 'not a number' },
    { status: 'ACTIVE' },
    { userId: 'another-user' },
    { customerId: 'another-customer' },
  ])('rejects invalid or unauthorized fields %#', async (input) => {
    await expect(pipe.transform(input, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('preserves partial contact-only updates', async () => {
    await expect(pipe.transform({ phone: '0400 000 000' }, metadata)).resolves.toMatchObject({
      phone: '0400000000',
    });
  });
});
