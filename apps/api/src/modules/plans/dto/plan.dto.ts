import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreatePlanDto {
  @IsString() @MaxLength(150) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @Type(() => Number) @IsInt() @Min(1) downloadMbps!: number;
  @Type(() => Number) @IsInt() @Min(1) uploadMbps!: number;
  @Type(() => Number) @IsInt() @Min(1) monthlyCents!: number;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @MaxLength(150) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) downloadMbps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) uploadMbps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) monthlyCents?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
