import {
  InternalRequestLevel,
  InternalRequestPriority,
  InternalRequestStatus,
  InternalRequestType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { ListQueryDto } from '../../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateInternalRequestDto {
  @IsEnum(InternalRequestType)
  type!: InternalRequestType;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description!: string;

  @IsEnum(InternalRequestPriority)
  priority: InternalRequestPriority = InternalRequestPriority.NORMAL;

  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() supportCaseId?: string;
  @IsOptional() @IsUUID() invoiceId?: string;
  @IsOptional() @IsUUID() paymentId?: string;
  @IsOptional() @IsUUID() refundId?: string;
  @IsOptional() @IsUUID() subscriptionId?: string;
  @IsOptional() @IsUUID() planChangeRequestId?: string;
}

export class InternalRequestQueryDto extends ListQueryDto {
  @IsOptional()
  @IsIn(['updatedAt', 'createdAt', 'status', 'priority'])
  sortBy: 'updatedAt' | 'createdAt' | 'status' | 'priority' = 'updatedAt';

  @IsOptional() @IsEnum(InternalRequestStatus) status?: InternalRequestStatus;
  @IsOptional() @IsEnum(InternalRequestType) type?: InternalRequestType;
  @IsOptional() @IsEnum(InternalRequestPriority) priority?: InternalRequestPriority;
  @IsOptional() @IsEnum(InternalRequestLevel) currentLevel?: InternalRequestLevel;
  @IsOptional() @IsUUID() requestedByUserId?: string;
  @IsOptional() @IsIn(['ALL', 'UNASSIGNED', 'MINE']) assignment: 'ALL' | 'UNASSIGNED' | 'MINE' =
    'ALL';
}

export class InternalRequestContextQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) search?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32) supportCaseNumber?: string;
}

export class CreateInternalRequestMessageDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

export class OptionalInternalRequestCommentDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment?: string;
}

export class RequiredInternalRequestCommentDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment!: string;
}

export class EscalateInternalRequestDto {
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment?: string;

  @IsEnum(InternalRequestPriority)
  priority!: InternalRequestPriority;
}

export class InternalRequestAttachmentSignatureQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4_102_444_800)
  expires!: number;

  @IsString()
  @MinLength(32)
  @MaxLength(256)
  signature!: string;
}
