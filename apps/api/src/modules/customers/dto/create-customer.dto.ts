import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { AddressDto } from '../../../common/dto/address.dto';

export class CreateCustomerDto {
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MaxLength(100)
  lastName!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsPhoneNumber('AU')
  phone!: string;

  @IsString()
  @MaxLength(255)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsString()
  @MaxLength(100)
  suburb!: string;

  @IsString()
  @Length(2, 3)
  state!: string;

  @IsString()
  @Length(4, 10)
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
