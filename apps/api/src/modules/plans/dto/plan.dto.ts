import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePlanDto {
  @IsString() @MaxLength(150) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  highlights?: string[];
  @Type(() => Number) @IsInt() @Min(1) downloadMbps!: number;
  @Type(() => Number) @IsInt() @Min(1) uploadMbps!: number;
  @Type(() => Number) @IsInt() @Min(1) monthlyCents!: number;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) tierRank?: number;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @MaxLength(150) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  highlights?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) downloadMbps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) uploadMbps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) monthlyCents?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) tierRank?: number;
}

export class UpdatePlanHighlightsDto {
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  highlights!: string[];
}
