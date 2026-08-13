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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateSubscriptionDto,
  SubscriptionQueryDto,
  UpdateSubscriptionDto,
} from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}
  @Get() @Roles(Role.ADMIN, Role.STAFF) findAll(@Query() query: SubscriptionQueryDto) {
    return this.subscriptions.findAll(query);
  }
  @Get('me') @Roles(Role.CUSTOMER) findOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.findOwn(user);
  }
  @Get(':subscriptionId') @Roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER) findOne(
    @Param('subscriptionId', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.findOne(id, user);
  }
  @Post() @Roles(Role.ADMIN, Role.STAFF) create(@Body() input: CreateSubscriptionDto) {
    return this.subscriptions.create(input);
  }
  @Patch(':subscriptionId') @Roles(Role.ADMIN, Role.STAFF) update(
    @Param('subscriptionId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateSubscriptionDto,
  ) {
    return this.subscriptions.update(id, input);
  }
}
