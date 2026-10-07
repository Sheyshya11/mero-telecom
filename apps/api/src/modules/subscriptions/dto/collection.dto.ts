import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { CollectionSettings } from '../collection-policy.service';
export class UpdateCollectionPolicyDto implements CollectionSettings {
  @IsInt() @Min(1) @Max(365) firstReminderDays!: number;
  @IsInt() @Min(1) @Max(365) secondReminderDays!: number;
  @IsInt() @Min(1) @Max(365) finalWarningDays!: number;
  @IsInt() @Min(1) @Max(365) suspensionDays!: number;
}
export class CollectionHoldDto {
  @IsString() @MaxLength(1000) reason!: string;
}
export class CollectionReminderDto {
  @IsString() @MinLength(1) @MaxLength(100) requestKey!: string;
}
