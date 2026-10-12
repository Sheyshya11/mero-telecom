import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsOptional,
  IsISO8601,
  Equals,
  IsBoolean,
} from 'class-validator';
import type { CollectionSettings } from '../collection-policy.service';
export class UpdateCollectionPolicyDto implements CollectionSettings {
  @IsInt() @Min(1) @Max(365) firstReminderDays!: number;
  @IsInt() @Min(1) @Max(365) secondReminderDays!: number;
  @IsInt() @Min(1) @Max(365) finalWarningDays!: number;
  @IsInt() @Min(1) @Max(365) suspensionDays!: number;
}
export class CollectionHoldDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsISO8601() holdUntil?: string | null;
}
export class ReleaseCollectionHoldDto {
  @IsBoolean() @Equals(true) confirmed!: boolean;
}
export class CollectionReminderDto {
  @IsString() @MinLength(1) @MaxLength(100) requestKey!: string;
}
