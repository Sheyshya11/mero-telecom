import {
  Equals,
  IsBoolean,
  IsEmail,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

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

  @IsBoolean()
  residentialSameAsService!: boolean;

  @ValidateIf((input: CreatePublicPlanCheckoutSessionDto) => !input.residentialSameAsService)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  residentialAddressToken?: string;

  @IsBoolean()
  billingSameAsResidential!: boolean;

  @ValidateIf((input: CreatePublicPlanCheckoutSessionDto) => !input.billingSameAsResidential)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  billingAddressToken?: string;

  @IsBoolean()
  @Equals(true, { message: 'Terms must be accepted.' })
  termsAccepted!: boolean;

  @IsBoolean()
  @Equals(true, { message: 'Privacy policy must be accepted.' })
  privacyAccepted!: boolean;
}

export class PreparePublicCheckoutContextDto {
  @IsUUID()
  planId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  qualificationToken!: string;
}

export class PublicCheckoutStatusQueryDto {
  @IsString()
  @MaxLength(255)
  sessionId!: string;
}
