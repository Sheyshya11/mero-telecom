import { IsEmail, IsOptional, IsPhoneNumber, IsString, Length, MaxLength } from 'class-validator';

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
}
