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

export enum ReportingPeriodPreset {
  TODAY = 'today',
  YESTERDAY = 'yesterday',
  LAST_7_DAYS = 'last_7_days',
  THIS_MONTH = 'this_month',
  LAST_MONTH = 'last_month',
  THIS_QUARTER = 'this_quarter',
  THIS_FINANCIAL_YEAR = 'this_financial_year',
  CUSTOM = 'custom',
}

export enum ReceivablesBucket {
  CURRENT = 'current',
  DAYS_1_TO_30 = '1-30',
  DAYS_31_TO_60 = '31-60',
  DAYS_61_TO_90 = '61-90',
  DAYS_90_PLUS = '90+',
  OVERDUE = 'overdue',
  OVER_60 = 'over_60',
}

export class BillingReportQueryDto {
  @IsOptional() @IsEnum(ReportingPeriodPreset) preset?: ReportingPeriodPreset;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsEnum(InvoiceStatus) invoiceStatus?: InvoiceStatus;
  @IsOptional() @IsEnum(PaymentStatus) paymentStatus?: PaymentStatus;
  @IsOptional() @IsEnum(SubscriptionStatus) subscriptionStatus?: SubscriptionStatus;
  @IsOptional() @IsEnum(RefundStatus) refundStatus?: RefundStatus;
  @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
  @IsOptional() @IsEnum(RevenueGroupBy) groupBy?: RevenueGroupBy;
  @IsOptional() @IsEnum(ReceivablesBucket) ageingBucket?: ReceivablesBucket;
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
