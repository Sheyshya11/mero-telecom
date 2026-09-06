import { RefundReason, RefundStatus, RefundType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ListQueryDto } from '../../../common/pagination';

export class RequestRefundDto {
  @IsEnum(RefundReason)
  reason!: RefundReason;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;
}

export class RequestMoreInformationDto {
  @IsString()
  @MaxLength(2000)
  message!: string;
}

export class CreateAdminRefundDto extends RequestRefundDto {
  @IsUUID()
  paymentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNote?: string;
}

export class RefundQueryDto extends ListQueryDto {
  @IsOptional() @IsIn(['createdAt', 'requestedAt', 'refundAmountCents', 'status']) sortBy =
    'createdAt';
  @IsOptional() @IsDateString({ strict: true }) dateFrom?: string;
  @IsOptional() @IsDateString({ strict: true }) dateTo?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) minAmount?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) maxAmount?: number;

  @IsOptional()
  @IsEnum(RefundStatus)
  status?: RefundStatus;

  @IsOptional()
  @IsEnum(RefundType)
  type?: RefundType;

  @IsOptional()
  @IsEnum(RefundReason)
  reason?: RefundReason;
}

export class ReviewRefundDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNote?: string;
}

export class ApproveRefundDto {
  @IsEnum(RefundType)
  type!: RefundType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsEnum(RefundReason)
  reason?: RefundReason;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  overrideReason?: string;
}

export class RejectRefundDto {
  @IsString()
  @MaxLength(2000)
  internalNote!: string;
}

export class CancelRefundDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
