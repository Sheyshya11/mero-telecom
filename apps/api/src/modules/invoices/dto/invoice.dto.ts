import { InvoiceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class GenerateInvoiceDto {
  @IsUUID() subscriptionId!: string;
  @IsOptional() @IsDateString() issueDate?: string;
}

export class InvoiceQueryDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) limit = 20;
}

export class UpdateInvoiceStatusDto {
  @IsEnum(InvoiceStatus) status!: InvoiceStatus;
}
