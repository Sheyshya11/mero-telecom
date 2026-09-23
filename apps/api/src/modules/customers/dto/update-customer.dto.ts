import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  Matches,
  MinLength,
} from 'class-validator';
import { CustomerStatus } from '@prisma/client';
import { AUSTRALIAN_STATES } from '../../../common/dto/address.dto';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
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
  @MinLength(1)
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  suburb?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsIn(AUSTRALIAN_STATES)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Postcode must contain four digits.' })
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
  @MinLength(1)
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  suburb?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsIn(AUSTRALIAN_STATES)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Postcode must contain four digits.' })
  postcode?: string;
}
