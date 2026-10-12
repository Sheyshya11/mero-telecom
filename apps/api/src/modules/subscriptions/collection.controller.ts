import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CollectionPolicyService } from './collection-policy.service';
import { CollectionService } from './collection.service';
import {
  CollectionHoldDto,
  ReleaseCollectionHoldDto,
  CollectionReminderDto,
  UpdateCollectionPolicyDto,
} from './dto/collection.dto';
@Controller('collections')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CollectionController {
  constructor(
    private readonly policy: CollectionPolicyService,
    private readonly collections: CollectionService,
  ) {}
  @Get('me') @Roles(Role.CUSTOMER) own(@CurrentUser() actor: AuthenticatedUser) {
    return this.collections.customerSummary(actor);
  }
  @Get('policy') @Roles(Role.ADMIN, Role.STAFF) getPolicy() {
    return this.policy.get();
  }
  @Put('policy') @Roles(Role.SUPER_ADMIN) updatePolicy(
    @Body() input: UpdateCollectionPolicyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.policy.update(input, actor);
  }
  @Get('subscriptions/:id/history') @Roles(Role.ADMIN, Role.STAFF) history(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.collections.history(id);
  }
  @Post('invoices/:id/remind') @Roles(Role.ADMIN, Role.STAFF) remind(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CollectionReminderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.collections.manualReminder(id, actor, input.requestKey);
  }
  @Put('subscriptions/:id/hold') @Roles(Role.ADMIN) hold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CollectionHoldDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.collections.setHold(id, input.reason, actor, input);
  }
  @Post('subscriptions/:id/hold/release') @Roles(Role.ADMIN) releaseHold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReleaseCollectionHoldDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.collections.releaseHold(id, actor, input.confirmed);
  }
}
