import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MAX_PLAN_SPEED_MBPS = 100_000;
const MAX_MONTHLY_CENTS = 100_000_000;
const MAX_TIER_RANK = 1_000_000;

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeHighlights({ value }: { value: unknown }): unknown {
  return Array.isArray(value)
    ? value.map((highlight) => (typeof highlight === 'string' ? highlight.trim() : highlight))
    : value;
}

export class CreatePlanDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(2000)
  description?: string;
  @IsOptional()
  @Transform(normalizeHighlights)
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  highlights?: string[];
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PLAN_SPEED_MBPS) downloadMbps!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PLAN_SPEED_MBPS) uploadMbps!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_MONTHLY_CENTS) monthlyCents!: number;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_TIER_RANK) tierRank?: number;
}

export class UpdatePlanDto {
  @IsISO8601()
  expectedUpdatedAt!: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(2000)
  description?: string | null;
  @IsOptional()
  @Transform(normalizeHighlights)
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  highlights?: string[];
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PLAN_SPEED_MBPS)
  downloadMbps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PLAN_SPEED_MBPS) uploadMbps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_MONTHLY_CENTS) monthlyCents?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_TIER_RANK) tierRank?: number;
}

export class UpdatePlanHighlightsDto {
  @IsISO8601()
  expectedUpdatedAt!: string;
  @Transform(normalizeHighlights)
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  highlights!: string[];
}

export class DeletePlanDto {
  @IsISO8601()
  expectedUpdatedAt!: string;
}
