import { NotificationSeverity } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { ListQueryDto } from '../../../common/pagination';

export class NotificationQueryDto extends ListQueryDto {
  @IsOptional()
  @IsIn(['all', 'unread', 'read'])
  status: 'all' | 'unread' | 'read' = 'all';

  @IsOptional()
  @IsEnum(NotificationSeverity)
  severity?: NotificationSeverity;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Z][A-Z0-9_]*$/)
  type?: string;
}
