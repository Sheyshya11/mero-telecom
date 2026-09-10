import {
  CancellationReason,
  CancellationStatus,
  CancellationType,
  MockDisconnectionScenario,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { ListQueryDto } from '../../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CancellationPreviewQueryDto {
  @IsEnum(CancellationType)
  type!: CancellationType;
}

export class CreateCancellationDto {
  @IsEnum(CancellationType)
  type!: CancellationType;

  @IsEnum(CancellationReason)
  reason!: CancellationReason;

  @ValidateIf(
    (input: CreateCancellationDto, value: unknown) =>
      input.reason === CancellationReason.OTHER || value !== undefined,
  )
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(2000)
  reasonDetails?: string;

  @IsBoolean()
  @Equals(true, { message: 'You must confirm that you understand the service will stop.' })
  confirmed!: boolean;
}

export class CancellationQueryDto extends ListQueryDto {
  @IsOptional() @IsEnum(CancellationStatus) status?: CancellationStatus;
  @IsOptional() @IsEnum(CancellationType) type?: CancellationType;
  @IsOptional() @IsEnum(CancellationReason) reason?: CancellationReason;
  @IsOptional() @IsDateString({ strict: true }) dateFrom?: string;
  @IsOptional() @IsDateString({ strict: true }) dateTo?: string;
  @IsOptional()
  @IsIn(['requestedAt', 'createdAt', 'effectiveAt', 'status', 'updatedAt'])
  sortBy: 'requestedAt' | 'createdAt' | 'effectiveAt' | 'status' | 'updatedAt' = 'requestedAt';
}

export class RetryCancellationDto {
  @IsOptional()
  @IsEnum(MockDisconnectionScenario)
  mockScenario?: MockDisconnectionScenario;
}

export class CreateCancellationNoteDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

export class ReconciliationBatchDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
