import { Transform, Type } from 'class-transformer';
import {
  CancellationProviderStatus,
  InternalRequestPriority,
  MockRelocationOutcome,
  ServiceProvisioningStatus,
  ServiceRelocationStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  MinLength,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class QualifyRelocationDto {
  @IsString()
  @Length(40, 100)
  @Matches(/^[A-Za-z0-9_-]+$/)
  selectionToken!: string;
}

export class CreateRelocationDto {
  @IsString()
  @Length(40, 100)
  @Matches(/^[A-Za-z0-9_-]+$/)
  qualificationToken!: string;

  @IsUUID()
  requestedPlanId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  requestedMoveDate!: string;

  @IsBoolean()
  billingSameAsService!: boolean;

  @ValidateIf((input: CreateRelocationDto) => !input.billingSameAsService)
  @IsString()
  @Length(40, 100)
  @Matches(/^[A-Za-z0-9_-]+$/)
  billingAddressSelectionToken?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  requestedOldServiceDisconnectionDate?: string;
}

export class RelocationQueryDto {
  @IsOptional()
  @IsEnum(ServiceRelocationStatus)
  status?: ServiceRelocationStatus;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @IsOptional()
  @IsEnum(ServiceProvisioningStatus)
  provisioningStatus?: ServiceProvisioningStatus;

  @IsOptional()
  @IsEnum(CancellationProviderStatus)
  disconnectionStatus?: CancellationProviderStatus;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  requestedFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  requestedTo?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  createdFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  createdTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  search?: string;
}

export class CancelRelocationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason?: string;
}

export class RescheduleRelocationDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  requestedMoveDate!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  requestedOldServiceDisconnectionDate?: string;
}

export class AddRelocationNoteDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

export class EscalateRelocationDto {
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;

  @IsEnum(InternalRequestPriority)
  priority: InternalRequestPriority = InternalRequestPriority.HIGH;
}

export class DemoRelocationOutcomeDto {
  @IsIn(['PROVISIONING', 'DISCONNECTION'])
  operation!: 'PROVISIONING' | 'DISCONNECTION';

  @IsEnum(MockRelocationOutcome)
  outcome!: MockRelocationOutcome;

  @IsOptional()
  @IsBoolean()
  processNow = true;
}

export enum RelocationOverrideAction {
  REOPEN = 'REOPEN',
  SET_STATUS = 'SET_STATUS',
  MARK_NEW_SERVICE_ACTIVE = 'MARK_NEW_SERVICE_ACTIVE',
  MARK_OLD_SERVICE_DISCONNECTED = 'MARK_OLD_SERVICE_DISCONNECTED',
  FORCE_RETRY_PROVISIONING = 'FORCE_RETRY_PROVISIONING',
  FORCE_RETRY_DISCONNECTION = 'FORCE_RETRY_DISCONNECTION',
  FORCE_CLOSE = 'FORCE_CLOSE',
}

export class OverrideRelocationDto {
  @IsEnum(RelocationOverrideAction)
  action!: RelocationOverrideAction;

  @IsOptional()
  @IsEnum(ServiceRelocationStatus)
  targetStatus?: ServiceRelocationStatus;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class ResolveRelocationEscalationDto {
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}
