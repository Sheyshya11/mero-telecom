import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaymentMethodType } from '@prisma/client';

export class CreateCheckoutSessionDto {
  @IsUUID()
  invoiceId!: string;
}

export class CreatePlanCheckoutSessionDto {
  @IsUUID()
  planId!: string;
}

export class CreateRecurringSetupSessionDto {
  @IsUUID()
  subscriptionId!: string;

  @IsOptional()
  @IsEnum(PaymentMethodType)
  paymentMethodType?: PaymentMethodType;
}

export class PaymentMethodSelectionDto {
  @IsOptional()
  @IsEnum(PaymentMethodType)
  paymentMethodType?: PaymentMethodType;
}

export class PaymentMethodParamsDto {
  @IsString()
  @Matches(/^pm_[A-Za-z0-9]+$/)
  paymentMethodId!: string;
}

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  billingName?: string;

  @ValidateIf(
    (input: UpdatePaymentMethodDto) =>
      input.billingEmail !== undefined && input.billingEmail !== '',
  )
  @IsEmail()
  @MaxLength(320)
  billingEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  billingPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  billingAddressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  billingAddressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  billingCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  billingState?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  billingPostalCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^$|^[A-Za-z]{2}$/, { message: 'billingCountry must be a two-letter country code.' })
  billingCountry?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  cardExpMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2200)
  cardExpYear?: number;
}

export class CreatePublicPlanCheckoutSessionDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsEnum(PaymentMethodType)
  paymentMethodType?: PaymentMethodType;

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
