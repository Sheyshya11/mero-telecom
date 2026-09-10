import {
  SupportCategory,
  SupportPriority,
  SupportRequestType,
  SupportStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { ListQueryDto } from '../../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateSupportCaseDto {
  @IsEnum(SupportCategory)
  category!: SupportCategory;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;
}

export class CreateSupportMessageDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

const prospectCategories = [
  SupportCategory.PLANS_AND_PRICING,
  SupportCategory.NBN_AVAILABILITY,
  SupportCategory.ADDRESS_CHECK,
  SupportCategory.SIGNUP_HELP,
  SupportCategory.ORDER_HELP,
  SupportCategory.PAYMENT_HELP,
  SupportCategory.GENERAL_ENQUIRY,
  SupportCategory.OTHER,
] as const;

export class CreatePublicEnquiryDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsIn(prospectCategories)
  category!: SupportCategory;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message!: string;

  // Honeypot. The real form leaves this blank; simple form-filling bots usually do not.
  @IsOptional()
  @IsString()
  @MaxLength(0)
  website?: string;
}

export class LinkSupportCustomerDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  customerNumber!: string;
}

export class SupportCaseQueryDto extends ListQueryDto {
  @IsOptional()
  @IsIn(['updatedAt', 'createdAt', 'status', 'priority'])
  sortBy: 'updatedAt' | 'createdAt' | 'status' | 'priority' = 'updatedAt';
  @IsOptional() @IsEnum(SupportStatus) status?: SupportStatus;
  @IsOptional() @IsEnum(SupportCategory) category?: SupportCategory;
  @IsOptional() @IsEnum(SupportRequestType) requestType?: SupportRequestType;
  @IsOptional() @IsIn(['ALL', 'UNASSIGNED', 'MINE']) assignment: 'ALL' | 'UNASSIGNED' | 'MINE' =
    'ALL';
}

export class UpdateSupportStatusDto {
  @IsEnum(SupportStatus)
  status!: SupportStatus;
}

export class UpdateSupportPriorityDto {
  @IsEnum(SupportPriority)
  priority!: SupportPriority;
}

export class ResolveSupportCaseDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  resolutionNote!: string;
}

export class AttachmentSignatureQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expires!: number;

  @IsString()
  @MinLength(64)
  @MaxLength(64)
  signature!: string;
}
