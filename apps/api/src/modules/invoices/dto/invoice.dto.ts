import { InvoiceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsUUID, Min, Max } from 'class-validator';
import { ListQueryDto } from '../../../common/pagination';

export class GenerateInvoiceDto {
  @IsUUID() subscriptionId!: string;
  @IsOptional() @IsDateString() issueDate?: string;
}

export class InvoiceQueryDto extends ListQueryDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(['createdAt', 'issueDate', 'dueDate', 'totalCents']) sortBy = 'createdAt';
  @IsOptional()
  @IsIn([...Object.values(InvoiceStatus), 'UNPAID', 'REFUNDED', 'PARTIALLY_REFUNDED'])
  status?: InvoiceStatus | 'UNPAID' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  @IsOptional() @IsDateString({ strict: true }) dateFrom?: string;
  @IsOptional() @IsDateString({ strict: true }) dateTo?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) minAmount?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) maxAmount?: number;
}

export class UpdateInvoiceStatusDto {
  @IsEnum(InvoiceStatus) status!: InvoiceStatus;
}
