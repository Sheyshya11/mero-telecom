import { CustomerStatus, SubscriptionStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ListQueryDto } from '../../../common/pagination';

export class PaginationQueryDto extends ListQueryDto {
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'firstName', 'lastName', 'email', 'status'])
  sortBy = 'createdAt';
  @IsOptional() @IsEnum(CustomerStatus) status?: CustomerStatus;
  @IsOptional()
  @IsIn([...Object.values(SubscriptionStatus), 'NO_SUBSCRIPTION'])
  subscriptionStatus?: SubscriptionStatus | 'NO_SUBSCRIPTION';
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsIn(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']) state?: string;
  @IsOptional() @IsString() @MaxLength(10) postcode?: string;
  @IsOptional() @IsDateString({ strict: true }) createdFrom?: string;
  @IsOptional() @IsDateString({ strict: true }) createdTo?: string;
}
