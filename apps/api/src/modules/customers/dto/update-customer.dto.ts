import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { CustomerStatus } from '@prisma/client';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsPhoneNumber('AU')
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  suburb?: string;

  @IsOptional()
  @IsString()
  @Length(2, 3)
  state?: string;

  @IsOptional()
  @IsString()
  @Length(4, 10)
  postcode?: string;

  @IsOptional()
  @Type(() => String)
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;
}

export class UpdateOwnCustomerDto {
  @IsOptional()
  @IsPhoneNumber('AU')
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  suburb?: string;

  @IsOptional()
  @IsString()
  @Length(2, 3)
  state?: string;

  @IsOptional()
  @IsString()
  @Length(4, 10)
  postcode?: string;
}
