import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { AddressDto, AUSTRALIAN_STATES } from '../../../common/dto/address.dto';

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsPhoneNumber('AU')
  phone!: string;

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

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  serviceAddress?: AddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  billingAddress?: AddressDto;
}
