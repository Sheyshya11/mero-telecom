import {
  BillingCycle,
  InvoiceStatus,
  PaymentStatus,
  RefundStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum BillingReportType {
  REVENUE = 'revenue',
  INVOICES = 'invoices',
  PAYMENTS = 'payments',
  RECEIVABLES = 'receivables',
  REFUNDS = 'refunds',
  SUBSCRIPTIONS = 'subscriptions',
  RECONCILIATION = 'reconciliation',
}

export enum RevenueGroupBy {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class BillingReportQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsEnum(InvoiceStatus) invoiceStatus?: InvoiceStatus;
  @IsOptional() @IsEnum(PaymentStatus) paymentStatus?: PaymentStatus;
  @IsOptional() @IsEnum(SubscriptionStatus) subscriptionStatus?: SubscriptionStatus;
  @IsOptional() @IsEnum(RefundStatus) refundStatus?: RefundStatus;
  @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
  @IsOptional() @IsEnum(RevenueGroupBy) groupBy?: RevenueGroupBy;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
  @IsOptional()
  @IsString()
  @IsIn(['date', 'amount', 'customer', 'invoiceNumber', 'dueDate', 'status'])
  sortBy = 'date';
  @IsOptional() @IsIn(['asc', 'desc']) sortDirection: 'asc' | 'desc' = 'desc';
}

export class ExportReportDto extends BillingReportQueryDto {
  @IsIn(['csv', 'pdf', 'xlsx'])
  format!: 'csv' | 'pdf' | 'xlsx';
}
