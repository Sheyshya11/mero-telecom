import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export class ApproveServiceRequestDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) reviewNotes?: string;
}
export class RejectServiceRequestDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) reason!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) reviewNotes?: string;
}
