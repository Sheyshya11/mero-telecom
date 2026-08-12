import type { ArgumentMetadata } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { IsString } from 'class-validator';

import { createValidationPipe } from './create-validation-pipe';

class ExampleDto {
  @IsString()
  name!: string;
}

describe('createValidationPipe', () => {
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: ExampleDto,
  };

  it('rejects properties that are not declared in a DTO', async () => {
    const pipe = createValidationPipe();

    await expect(
      pipe.transform({ name: 'Mero', unexpected: true }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
