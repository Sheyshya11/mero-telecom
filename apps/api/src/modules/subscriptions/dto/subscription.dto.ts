import { IsDateString, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { BillingCycle, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { ListQueryDto } from '../../../common/pagination';

export class UpdateSubscriptionDto {
  @IsOptional() @IsEnum(SubscriptionStatus) status?: SubscriptionStatus;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string | null;
}

export class SubscriptionQueryDto extends ListQueryDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(['createdAt', 'startDate', 'currentPeriodEnd', 'status']) sortBy =
    'createdAt';
  @IsOptional() @IsEnum(SubscriptionStatus) status?: SubscriptionStatus;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
  @IsOptional() @IsEnum(PaymentStatus) paymentStatus?: PaymentStatus;
  @IsOptional() @IsDateString({ strict: true }) activatedFrom?: string;
  @IsOptional() @IsDateString({ strict: true }) activatedTo?: string;
  @IsOptional() @IsIn(['true', 'false']) cancelled?: string;
  @IsOptional() @IsIn(['true', 'false']) pendingPlanChange?: string;
}
