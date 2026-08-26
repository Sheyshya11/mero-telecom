import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CoverageResultStatus, AccessTechnology } from '@prisma/client';
import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class AddressSuggestionQueryDto {
  @ApiProperty({
    example: '12 King William Street Adelaide',
    minLength: 3,
    maxLength: 150,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  query!: string;
}

export class CoverageCheckDto {
  @ApiProperty({
    description: 'Short-lived opaque token returned for a selected address suggestion.',
  })
  @IsString()
  @Length(40, 100)
  @Matches(/^[A-Za-z0-9_-]+$/)
  selectionToken!: string;
}

export class AddressSuggestionDto {
  @ApiProperty() selectionToken!: string;
  @ApiProperty() formattedAddress!: string;
  @ApiProperty({ nullable: true }) suburb!: string | null;
  @ApiProperty({ nullable: true }) state!: string | null;
  @ApiProperty({ nullable: true }) stateCode!: string | null;
  @ApiProperty({ nullable: true }) postcode!: string | null;
}

export class AddressSuggestionsResponseDto {
  @ApiProperty({ type: [AddressSuggestionDto] }) suggestions!: AddressSuggestionDto[];
}

export class CoverageAddressDto {
  @ApiProperty() formattedAddress!: string;
  @ApiProperty({ nullable: true }) suburb!: string | null;
  @ApiProperty({ nullable: true }) stateCode!: string | null;
  @ApiProperty({ nullable: true }) postcode!: string | null;
}

export class CoverageQualificationDto {
  @ApiProperty({ enum: AccessTechnology, nullable: true })
  technology!: AccessTechnology | null;
  @ApiProperty({ nullable: true }) maximumSpeedMbps!: number | null;
  @ApiProperty({ enum: ['DATABASE_ESTIMATE'] }) source!: 'DATABASE_ESTIMATE';
  @ApiProperty({ format: 'date-time' }) checkedAt!: string;
}

export class CoveragePlanDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() downloadMbps!: number;
  @ApiProperty() uploadMbps!: number;
  @ApiProperty() monthlyCents!: number;
}

export class CoverageResponseDto {
  @ApiProperty() available!: boolean;
  @ApiProperty({ enum: CoverageResultStatus }) status!: CoverageResultStatus;
  @ApiProperty() message!: string;
  @ApiProperty({ type: CoverageAddressDto }) address!: CoverageAddressDto;
  @ApiProperty({ type: CoverageQualificationDto }) qualification!: CoverageQualificationDto;
  @ApiProperty({ type: [CoveragePlanDto] }) plans!: CoveragePlanDto[];
  @ApiProperty({ nullable: true, description: 'Short-lived token for preparing guest checkout.' })
  qualificationToken!: string | null;
}
