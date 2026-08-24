import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsPhoneNumber,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { AddressDto } from '../../../common/dto/address.dto';

export class CreateCheckoutSessionDto {
  @IsUUID()
  invoiceId!: string;
}

export class CreatePlanCheckoutSessionDto {
  @IsUUID()
  planId!: string;
}

export class CreatePublicPlanCheckoutSessionDto {
  @IsUUID()
  planId!: string;

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

  @ValidateNested()
  @Type(() => AddressDto)
  residentialAddress!: AddressDto;

  @ValidateNested()
  @Type(() => AddressDto)
  serviceAddress!: AddressDto;

  @ValidateNested()
  @Type(() => AddressDto)
  billingAddress!: AddressDto;

  @IsBoolean()
  @Equals(true, { message: 'Terms must be accepted.' })
  termsAccepted!: boolean;

  @IsBoolean()
  @Equals(true, { message: 'Privacy policy must be accepted.' })
  privacyAccepted!: boolean;
}

export class PublicCheckoutStatusQueryDto {
  @IsString()
  @MaxLength(255)
  sessionId!: string;
}
