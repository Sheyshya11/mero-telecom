import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  AccessTechnology,
  AddressOverrideStatus,
  OperatingRegionStatus,
  PostcodeCoverageStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CoverageSearchQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class OperatingRegionQueryDto extends CoverageSearchQueryDto {
  @ApiPropertyOptional({ enum: OperatingRegionStatus })
  @IsOptional()
  @IsEnum(OperatingRegionStatus)
  status?: OperatingRegionStatus;
}

export class CreateOperatingRegionDto {
  @ApiProperty({ example: 'AU' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  countryCode!: string;

  @ApiProperty({ example: 'SA' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z]{2,3}$/)
  stateCode!: string;

  @ApiProperty({ example: 'South Australia' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: OperatingRegionStatus })
  @IsEnum(OperatingRegionStatus)
  status!: OperatingRegionStatus;
}

export class UpdateOperatingRegionDto extends PartialType(CreateOperatingRegionDto) {}

export class PostcodeCoverageQueryDto extends CoverageSearchQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  operatingRegionId?: string;

  @ApiPropertyOptional({ enum: PostcodeCoverageStatus })
  @IsOptional()
  @IsEnum(PostcodeCoverageStatus)
  status?: PostcodeCoverageStatus;
}

export class CreatePostcodeCoverageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  operatingRegionId!: string;

  @ApiProperty({ example: '5000' })
  @IsString()
  @Matches(/^\d{4}$/)
  postcode!: string;

  @ApiProperty({ enum: PostcodeCoverageStatus })
  @IsEnum(PostcodeCoverageStatus)
  status!: PostcodeCoverageStatus;

  @ApiPropertyOptional({ enum: AccessTechnology })
  @ValidateIf(
    (input: CreatePostcodeCoverageDto) =>
      input.technology !== null &&
      (input.status === PostcodeCoverageStatus.AVAILABLE || input.technology !== undefined),
  )
  @IsEnum(AccessTechnology)
  technology?: AccessTechnology | null;

  @ApiPropertyOptional({ minimum: 1 })
  @ValidateIf(
    (input: CreatePostcodeCoverageDto) =>
      input.maximumSpeedMbps !== null &&
      (input.status === PostcodeCoverageStatus.AVAILABLE || input.maximumSpeedMbps !== undefined),
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maximumSpeedMbps?: number | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  availabilityDate?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNotes?: string | null;
}

export class UpdatePostcodeCoverageDto extends PartialType(CreatePostcodeCoverageDto) {}

export class AddressOverrideQueryDto extends CoverageSearchQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  operatingRegionId?: string;

  @ApiPropertyOptional({ enum: AddressOverrideStatus })
  @IsOptional()
  @IsEnum(AddressOverrideStatus)
  status?: AddressOverrideStatus;
}

export class CreateAddressOverrideDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  operatingRegionId!: string;

  @ApiProperty({ example: 'geoapify' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MaxLength(50)
  provider!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  providerAddressId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  formattedAddress!: string;

  @ApiProperty({ example: 'SA' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z]{2,3}$/)
  stateCode!: string;

  @ApiProperty({ example: '5000' })
  @IsString()
  @Matches(/^\d{4}$/)
  postcode!: string;

  @ApiProperty({ enum: AddressOverrideStatus })
  @IsEnum(AddressOverrideStatus)
  status!: AddressOverrideStatus;

  @ApiPropertyOptional({ enum: AccessTechnology })
  @ValidateIf(
    (input: CreateAddressOverrideDto) =>
      input.technology !== null &&
      (input.status === AddressOverrideStatus.AVAILABLE || input.technology !== undefined),
  )
  @IsEnum(AccessTechnology)
  technology?: AccessTechnology | null;

  @ApiPropertyOptional({ minimum: 1 })
  @ValidateIf(
    (input: CreateAddressOverrideDto) =>
      input.maximumSpeedMbps !== null &&
      (input.status === AddressOverrideStatus.AVAILABLE || input.maximumSpeedMbps !== undefined),
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maximumSpeedMbps?: number | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  availabilityDate?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNotes?: string | null;
}

export class UpdateAddressOverrideDto extends PartialType(CreateAddressOverrideDto) {}

export class CreateAddressOverrideFromSelectionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  operatingRegionId!: string;

  @ApiProperty({ description: 'Short-lived token returned by address autocomplete.' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  selectionToken!: string;

  @ApiProperty({ enum: AddressOverrideStatus })
  @IsEnum(AddressOverrideStatus)
  status!: AddressOverrideStatus;

  @ApiPropertyOptional({ enum: AccessTechnology })
  @ValidateIf(
    (input: CreateAddressOverrideFromSelectionDto) =>
      input.technology !== null &&
      (input.status === AddressOverrideStatus.AVAILABLE || input.technology !== undefined),
  )
  @IsEnum(AccessTechnology)
  technology?: AccessTechnology | null;

  @ApiPropertyOptional({ minimum: 1 })
  @ValidateIf(
    (input: CreateAddressOverrideFromSelectionDto) =>
      input.maximumSpeedMbps !== null &&
      (input.status === AddressOverrideStatus.AVAILABLE || input.maximumSpeedMbps !== undefined),
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maximumSpeedMbps?: number | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  availabilityDate?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNotes?: string | null;
}

export class PlanCoverageRuleQueryDto extends CoverageSearchQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  operatingRegionId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ enum: AccessTechnology })
  @IsOptional()
  @IsEnum(AccessTechnology)
  technology?: AccessTechnology;
}

export class CreatePlanCoverageRuleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  planId!: string;

  @ApiProperty({ enum: AccessTechnology })
  @IsEnum(AccessTechnology)
  technology!: AccessTechnology;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minimumSpeedMbps?: number | null;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maximumSpeedMbps?: number | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  operatingRegionId?: string | null;

  @ApiPropertyOptional({ example: '5000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/)
  postcode?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePlanCoverageRuleDto extends PartialType(CreatePlanCoverageRuleDto) {}

export class CoverageAnalyticsQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days = 30;
}
