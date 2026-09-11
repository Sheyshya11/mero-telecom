import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { asCustomerContext, type AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ExtendGracePeriodDto,
  SubscriptionQueryDto,
  SuspendSubscriptionDto,
  UpdateSubscriptionDto,
} from './dto/subscription.dto';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly lifecycle: SubscriptionLifecycleService,
  ) {}
  @Get() @Roles(Role.ADMIN, Role.STAFF) findAll(@Query() query: SubscriptionQueryDto) {
    return this.subscriptions.findAll(query);
  }
  @Get('me') @Roles(Role.CUSTOMER) findOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.findOwn(user);
  }
  @Get('me/:subscriptionId') @Roles(Role.CUSTOMER) findOwnOne(
    @Param('subscriptionId', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.findOne(id, asCustomerContext(user));
  }
  @Get(':subscriptionId') @Roles(Role.ADMIN, Role.STAFF) findOne(
    @Param('subscriptionId', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.findOne(id, user);
  }
  @Patch(':subscriptionId') @Roles(Role.ADMIN) update(
    @Param('subscriptionId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateSubscriptionDto,
  ) {
    return this.subscriptions.update(id, input);
  }
  @Post(':subscriptionId/extend-grace-period') @Roles(Role.ADMIN) extendGracePeriod(
    @Param('subscriptionId', new ParseUUIDPipe()) id: string,
    @Body() input: ExtendGracePeriodDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lifecycle.extendGracePeriod(id, input.days, user);
  }
  @Post(':subscriptionId/suspend') @Roles(Role.ADMIN) suspend(
    @Param('subscriptionId', new ParseUUIDPipe()) id: string,
    @Body() input: SuspendSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lifecycle.suspendAdministratively(id, user, input.reason);
  }
  @Post(':subscriptionId/reactivate') @Roles(Role.ADMIN) reactivate(
    @Param('subscriptionId', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lifecycle.reactivateAdministratively(id, user);
  }
  @Post(':subscriptionId/terminate') @Roles(Role.SUPER_ADMIN) terminate(
    @Param('subscriptionId', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lifecycle.terminateForNonPayment(id, user);
  }
}
