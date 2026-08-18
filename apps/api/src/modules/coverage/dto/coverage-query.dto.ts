import { IsString, Matches } from 'class-validator';

export class CoverageQueryDto {
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Postcode must contain four digits.' })
  postcode!: string;
}
