import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { asCustomerContext, type AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanChangeQueryDto, PlanChangeTargetDto } from './dto/plan-change.dto';
import { PlanChangesService } from './plan-changes.service';

@ApiTags('plan changes')
@ApiBearerAuth()
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionPlanChangesController {
  constructor(private readonly planChanges: PlanChangesService) {}

  @Post(':subscriptionId/plan-change/preview')
  @ApiOperation({ summary: 'Preview an owned subscription plan change using server billing data' })
  @Roles(Role.CUSTOMER)
  preview(
    @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    @Body() input: PlanChangeTargetDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planChanges.preview(subscriptionId, input.targetPlanId, asCustomerContext(actor));
  }

  @Post(':subscriptionId/plan-change')
  @ApiOperation({ summary: 'Create an upgrade Checkout or schedule a downgrade' })
  @Roles(Role.CUSTOMER)
  request(
    @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    @Body() input: PlanChangeTargetDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planChanges.request(subscriptionId, input.targetPlanId, asCustomerContext(actor));
  }

  @Get(':subscriptionId/plan-change')
  @ApiOperation({ summary: 'Get the latest plan change for an owned subscription' })
  @Roles(Role.CUSTOMER)
  latest(
    @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planChanges.latestForSubscription(subscriptionId, asCustomerContext(actor));
  }
}

@ApiTags('plan changes')
@ApiBearerAuth()
@Controller('plan-change-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlanChangeRequestsController {
  constructor(private readonly planChanges: PlanChangesService) {}

  @Get('me')
  @Roles(Role.CUSTOMER)
  listMine(@Query() query: PlanChangeQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.planChanges.list(query, asCustomerContext(actor));
  }

  @Get('me/:requestId')
  @Roles(Role.CUSTOMER)
  findMineOne(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planChanges.findOne(requestId, asCustomerContext(actor));
  }

  @Get()
  @ApiOperation({ summary: 'List owned or role-authorised plan-change history' })
  @Roles(Role.ADMIN, Role.STAFF)
  list(@Query() query: PlanChangeQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.planChanges.list(query, actor);
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Get a safe plan-change request status' })
  @Roles(Role.ADMIN, Role.STAFF)
  findOne(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planChanges.findOne(requestId, actor);
  }

  @Post(':requestId/cancel')
  @ApiOperation({ summary: 'Cancel an owned scheduled downgrade before its effective time' })
  @Roles(Role.CUSTOMER)
  cancel(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planChanges.cancelScheduled(requestId, asCustomerContext(actor));
  }

  @Post(':requestId/reconcile')
  @ApiOperation({ summary: 'Reconcile an owned upgrade from Stripe Checkout state' })
  @Roles(Role.CUSTOMER)
  reconcile(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planChanges.reconcile(requestId, asCustomerContext(actor));
  }
}
