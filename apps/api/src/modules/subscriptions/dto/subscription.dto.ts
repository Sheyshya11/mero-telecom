import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { SubscriptionStatus } from '@prisma/client';

export class CreateSubscriptionDto {
  @IsUUID() customerId!: string;
  @IsUUID() planId!: string;
  @IsDateString() startDate!: string;
}

export class UpdateSubscriptionDto {
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsEnum(SubscriptionStatus) status?: SubscriptionStatus;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string | null;
}

export class SubscriptionQueryDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) limit = 20;
}
