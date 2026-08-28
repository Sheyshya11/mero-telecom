import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TrustedOriginGuard } from '../auth/trusted-origin.guard';
import {
  AcceptStaffInvitationDto,
  ChangeSystemRoleDto,
  ChangeSystemUserStatusDto,
  CreateStaffInvitationDto,
  SecurityAuditQueryDto,
  StaffInvitationQueryDto,
  SystemUserQueryDto,
  VerifyStaffInvitationDto,
} from './dto/system-user.dto';
import { StaffInvitationsService } from './staff-invitations.service';
import { SystemUsersService } from './system-users.service';
import { auditContextFromRequest } from './system-users.types';

@ApiTags('admin users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class SystemUsersController {
  constructor(
    private readonly users: SystemUsersService,
    private readonly invitations: StaffInvitationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List users without exposing authentication secrets.' })
  list(@Query() query: SystemUserQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.list(query, actor);
  }

  @Post('invitations')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Invite a staff member or administrator.' })
  createInvitation(
    @Body() input: CreateStaffInvitationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.invitations.create(input, actor, auditContextFromRequest(request));
  }

  @Get('invitations')
  listInvitations(
    @Query() query: StaffInvitationQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.invitations.list(query, actor);
  }

  @Post('invitations/:invitationId/resend')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resendInvitation(
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.invitations.resend(invitationId, actor, auditContextFromRequest(request));
  }

  @Post('invitations/:invitationId/revoke')
  revokeInvitation(
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.invitations.revoke(invitationId, actor, auditContextFromRequest(request));
  }

  @Patch(':userId/role')
  changeRole(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: ChangeSystemRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.users.changeRole(userId, input, actor, auditContextFromRequest(request));
  }

  @Patch(':userId/status')
  changeStatus(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: ChangeSystemUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.users.changeStatus(userId, input, actor, auditContextFromRequest(request));
  }
}

@ApiTags('security audit')
@ApiBearerAuth()
@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class SecurityAuditController {
  constructor(private readonly users: SystemUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List privileged security audit events.' })
  list(@Query() query: SecurityAuditQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.listAuditLogs(query, actor);
  }
}

@ApiTags('staff invitations')
@Controller('auth/staff-invitations')
export class StaffInvitationAcceptanceController {
  constructor(private readonly invitations: StaffInvitationsService) {}

  @Post('verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  verify(@Body() input: VerifyStaffInvitationDto) {
    return this.invitations.verify(input.token);
  }

  @Post('accept')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async accept(@Body() input: AcceptStaffInvitationDto, @Req() request: Request): Promise<void> {
    await this.invitations.accept(input.token, input.password, auditContextFromRequest(request));
  }
}
