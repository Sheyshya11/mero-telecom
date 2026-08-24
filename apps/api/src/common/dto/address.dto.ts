import { IsOptional, IsString, Length, MaxLength, Matches } from 'class-validator';

export class AddressDto {
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
  @Matches(/^\d{4}$/, { message: 'Postcode must contain four digits.' })
  postcode!: string;
}
