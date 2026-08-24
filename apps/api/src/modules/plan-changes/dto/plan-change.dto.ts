import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PlanChangeStatus, PlanChangeType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlanChangeTargetDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Active public internet plan selected by the customer',
  })
  @IsUUID()
  targetPlanId!: string;
}

export class PlanChangeQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Admin/Staff customer filter' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
  @ApiPropertyOptional({ enum: PlanChangeStatus })
  @IsOptional()
  @IsEnum(PlanChangeStatus)
  status?: PlanChangeStatus;
  @ApiPropertyOptional({ enum: PlanChangeType })
  @IsOptional()
  @IsEnum(PlanChangeType)
  type?: PlanChangeType;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit = 20;
}
