import { Type } from 'class-transformer';
import {
  IsEmail,
  IsDateString,
  IsUUID,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Role, StaffInvitationStatus, UserStatus } from '@prisma/client';
import { ListQueryDto } from '../../../common/pagination';

export class CreateStaffInvitationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsEnum(Role)
  @IsIn([Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF])
  role!: Extract<Role, 'SUPER_ADMIN' | 'ADMIN' | 'STAFF'>;
}

export class StaffInvitationQueryDto {
  @IsOptional()
  @IsEnum(StaffInvitationStatus)
  status?: StaffInvitationStatus;

  @IsOptional()
  @IsEnum(Role)
  @IsIn([Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF])
  role?: Extract<Role, 'SUPER_ADMIN' | 'ADMIN' | 'STAFF'>;

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
}

export class SystemUserQueryDto extends ListQueryDto {
  @IsOptional() @IsIn(['createdAt', 'updatedAt', 'displayName', 'email', 'role', 'status']) sortBy =
    'createdAt';
  @IsOptional() @IsDateString({ strict: true }) createdFrom?: string;
  @IsOptional() @IsDateString({ strict: true }) createdTo?: string;
  @IsOptional() @IsIn(['true', 'false']) active?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class ChangeSystemRoleDto {
  @IsEnum(Role)
  @IsIn([Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF])
  role!: Extract<Role, 'SUPER_ADMIN' | 'ADMIN' | 'STAFF'>;
}

export class SecurityAuditQueryDto extends ListQueryDto {
  @IsOptional() @IsIn(['createdAt', 'action', 'entityType']) sortBy = 'createdAt';
  @IsOptional() @IsUUID() actorUserId?: string;
  @IsOptional() @IsEnum(Role) actorRole?: Role;
  @IsOptional() @IsString() @MaxLength(255) entityId?: string;
  @IsOptional() @IsDateString({ strict: true }) dateFrom?: string;
  @IsOptional() @IsDateString({ strict: true }) dateTo?: string;
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;
}

export class ChangeSystemUserStatusDto {
  @IsEnum(UserStatus)
  @IsIn([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.DEACTIVATED])
  status!: Extract<UserStatus, 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'>;
}

export class VerifyStaffInvitationDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}

export class AcceptStaffInvitationDto extends VerifyStaffInvitationDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/[a-z]/, { message: 'Password must include a lowercase letter.' })
  @Matches(/[A-Z]/, { message: 'Password must include an uppercase letter.' })
  @Matches(/\d/, { message: 'Password must include a number.' })
  @Matches(/[^A-Za-z0-9]/, { message: 'Password must include a symbol.' })
  password!: string;
}
