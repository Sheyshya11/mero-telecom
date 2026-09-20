import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, Matches, MinLength } from 'class-validator';

export const AUSTRALIAN_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const;

export class AddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  suburb!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsIn(AUSTRALIAN_STATES)
  state!: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'Postcode must contain four digits.' })
  postcode!: string;
}
