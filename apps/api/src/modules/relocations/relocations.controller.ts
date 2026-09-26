import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AddRelocationNoteDto,
  CancelRelocationDto,
  CreateRelocationDto,
  DemoRelocationOutcomeDto,
  EscalateRelocationDto,
  OverrideRelocationDto,
  QualifyRelocationDto,
  RelocationQueryDto,
  RescheduleRelocationDto,
  ResolveRelocationEscalationDto,
} from './dto/relocation.dto';
import { RelocationsService } from './relocations.service';

@ApiTags('service relocations')
@ApiBearerAuth()
@Controller('subscriptions/:subscriptionId/relocations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionRelocationsController {
  constructor(private readonly relocations: RelocationsService) {}

  @Post('qualification')
  @Roles(Role.CUSTOMER)
  @ApiOperation({ summary: 'Qualify a selected new address for an active owned subscription.' })
  qualify(
    @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    @Body() input: QualifyRelocationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.qualify(subscriptionId, input.selectionToken, actor);
  }

  @Post()
  @Roles(Role.CUSTOMER)
  @ApiOperation({ summary: 'Create a relocation from a trusted qualification result.' })
  create(
    @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    @Body() input: CreateRelocationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.create(subscriptionId, input, actor);
  }

  @Get('current')
  @Roles(Role.CUSTOMER, Role.STAFF, Role.ADMIN)
  current(
    @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.current(subscriptionId, actor);
  }
}

@ApiTags('service relocations')
@ApiBearerAuth()
@Controller('relocations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RelocationsController {
  constructor(private readonly relocations: RelocationsService) {}

  @Get()
  @Roles(Role.STAFF, Role.ADMIN)
  list(@Query() query: RelocationQueryDto) {
    return this.relocations.list(query);
  }

  @Get(':relocationId')
  @Roles(Role.CUSTOMER, Role.STAFF, Role.ADMIN)
  findOne(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.findOne(id, actor);
  }

  @Post(':relocationId/confirm')
  @Roles(Role.CUSTOMER, Role.ADMIN)
  confirm(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.confirm(id, actor);
  }

  @Post(':relocationId/cancel')
  @Roles(Role.CUSTOMER, Role.ADMIN)
  cancel(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @Body() input: CancelRelocationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.cancel(id, actor, input.reason);
  }

  @Post(':relocationId/retry')
  @Roles(Role.ADMIN)
  retry(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.retry(id, actor);
  }

  @Post(':relocationId/retry-provisioning')
  @Roles(Role.ADMIN)
  retryProvisioning(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.retryProvisioning(id, actor);
  }

  @Post(':relocationId/retry-qualification')
  @Roles(Role.ADMIN)
  retryQualification(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.retryQualification(id, actor);
  }

  @Post(':relocationId/retry-disconnection')
  @Roles(Role.ADMIN)
  retryDisconnection(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.retryDisconnection(id, actor);
  }

  @Patch(':relocationId/schedule')
  @Roles(Role.ADMIN)
  reschedule(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @Body() input: RescheduleRelocationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.reschedule(id, input, actor);
  }

  @Post(':relocationId/notes')
  @Roles(Role.STAFF, Role.ADMIN)
  addNote(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @Body() input: AddRelocationNoteDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.addNote(id, input.body, actor);
  }

  @Post(':relocationId/escalate')
  @Roles(Role.ADMIN)
  escalate(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @Body() input: EscalateRelocationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.escalate(id, input, actor);
  }

  @Post(':relocationId/demo-outcome')
  @Roles(Role.ADMIN)
  demoOutcome(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @Body() input: DemoRelocationOutcomeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.configureDemoOutcome(id, input, actor);
  }

  @Post(':relocationId/resolve-escalation')
  @Roles(Role.SUPER_ADMIN)
  resolveEscalation(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @Body() input: ResolveRelocationEscalationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.resolveEscalation(id, input.reason, actor);
  }

  @Post(':relocationId/override')
  @Roles(Role.SUPER_ADMIN)
  override(
    @Param('relocationId', new ParseUUIDPipe()) id: string,
    @Body() input: OverrideRelocationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.relocations.override(id, input, actor);
  }
}
