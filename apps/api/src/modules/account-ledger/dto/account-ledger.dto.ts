import {
  AccountCreditClassification,
  AccountTransactionReason,
  AccountTransactionType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAccountTransactionDto {
  @IsUUID()
  customerId!: string;

  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsEnum(AccountTransactionType)
  type!: AccountTransactionType;

  @IsEnum(AccountTransactionReason)
  reason!: AccountTransactionReason;

  @IsOptional()
  @IsEnum(AccountCreditClassification)
  creditClassification?: AccountCreditClassification;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents?: number;

  @IsString()
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceId?: string;

  @IsOptional()
  @IsObject()
  calculation?: Record<string, unknown>;
}

export class ReverseAccountTransactionDto {
  @IsString()
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNote?: string;
}

export class ApproveAccountTransactionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  approvedAmountCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  approvalNote?: string;
}
