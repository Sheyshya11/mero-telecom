import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([10, 20, 50, 100]) limit = 20;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder: 'asc' | 'desc' = 'desc';
}

export function buildPaginationMeta(query: { page: number; limit: number }, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages,
    hasNextPage: query.page < totalPages,
    hasPreviousPage: query.page > 1,
  };
}

export function dateRange(from?: string, to?: string) {
  const gte = from ? new Date(from) : undefined;
  const lte = to ? new Date(to.length === 10 ? `${to}T23:59:59.999Z` : to) : undefined;
  if (gte && lte && gte > lte)
    throw new BadRequestException('Start date must not be after end date.');
  return from || to ? { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } : undefined;
}

// Monetary query values use cents, matching stored amounts.
export function amountRange(min?: number, max?: number) {
  if (min !== undefined && max !== undefined && min > max)
    throw new BadRequestException('Minimum amount must not exceed maximum amount.');
  return min !== undefined || max !== undefined
    ? { ...(min !== undefined ? { gte: min } : {}), ...(max !== undefined ? { lte: max } : {}) }
    : undefined;
}
