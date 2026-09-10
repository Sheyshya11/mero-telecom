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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { asCustomerContext, type AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CancellationsService } from './cancellations.service';
import {
  CancellationPreviewQueryDto,
  CancellationQueryDto,
  CreateCancellationDto,
  CreateCancellationNoteDto,
  RetryCancellationDto,
} from './dto/cancellation.dto';

@ApiTags('customer subscription cancellations')
@ApiBearerAuth()
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class CustomerCancellationsController {
  constructor(private readonly cancellations: CancellationsService) {}

  @Get(':subscriptionId/cancellation/preview')
  preview(
    @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    @Query() query: CancellationPreviewQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cancellations.preview(subscriptionId, query.type, asCustomerContext(actor));
  }

  @Post(':subscriptionId/cancellation')
  create(
    @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    @Body() input: CreateCancellationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cancellations.create(subscriptionId, input, asCustomerContext(actor));
  }

  @Get(':subscriptionId/cancellation')
  async find(
    @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      cancellation: await this.cancellations.findForCustomer(
        subscriptionId,
        asCustomerContext(actor),
      ),
    };
  }

  @Post(':subscriptionId/cancellation/revoke')
  revoke(
    @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cancellations.revoke(subscriptionId, asCustomerContext(actor));
  }
}

@ApiTags('service cancellations')
@ApiBearerAuth()
@Controller('admin/cancellations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STAFF, Role.ADMIN)
export class OperationsCancellationsController {
  constructor(private readonly cancellations: CancellationsService) {}

  @Get()
  list(@Query() query: CancellationQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.cancellations.list(query, actor);
  }

  @Get('summary')
  summary() {
    return this.cancellations.summary();
  }

  @Post('subscriptions/:subscriptionId')
  @Roles(Role.ADMIN)
  create(
    @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    @Body() input: CreateCancellationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cancellations.create(subscriptionId, input, actor);
  }

  @Get(':requestNumber')
  findOne(@Param('requestNumber') requestNumber: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.cancellations.findOne(requestNumber, actor);
  }

  @Post(':requestNumber/notes')
  addNote(
    @Param('requestNumber') requestNumber: string,
    @Body() input: CreateCancellationNoteDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cancellations.addNote(requestNumber, input.body, actor);
  }

  @Post(':requestNumber/revoke')
  @Roles(Role.ADMIN)
  revoke(@Param('requestNumber') requestNumber: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.cancellations.revokeForOperations(requestNumber, actor);
  }

  @Post(':requestNumber/retry')
  @Roles(Role.ADMIN)
  retry(
    @Param('requestNumber') requestNumber: string,
    @Body() input: RetryCancellationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cancellations.retry(requestNumber, actor, input.mockScenario);
  }
}
