import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { type AuthenticatedUser, asCustomerContext } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountLedgerService } from './account-ledger.service';
import {
  ApproveAccountTransactionDto,
  CreateAccountTransactionDto,
  ReverseAccountTransactionDto,
} from './dto/account-ledger.dto';

@ApiTags('account ledger')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountLedgerController {
  constructor(private readonly ledger: AccountLedgerService) {}

  @Get('account-ledger/me')
  @Roles(Role.CUSTOMER)
  mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.ledger.findMine(asCustomerContext(actor));
  }

  @Get('account-ledger/me/finance')
  @Roles(Role.CUSTOMER)
  financeMine(@CurrentUser() actor: AuthenticatedUser) {
    return this.ledger.financeMine(asCustomerContext(actor));
  }

  @Get('admin/customers/:customerId/finance')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.STAFF)
  finance(@Param('customerId', new ParseUUIDPipe()) customerId: string) {
    return this.ledger.financeSummary(customerId);
  }

  @Get('admin/customers/:customerId/ledger')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.STAFF)
  history(@Param('customerId', new ParseUUIDPipe()) customerId: string) {
    return this.ledger.findForCustomer(customerId);
  }

  @Post('admin/account-transactions')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  create(@Body() input: CreateAccountTransactionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.ledger.create(input, actor);
  }

  @Post('admin/account-transactions/:transactionId/approve')
  @Roles(Role.SUPER_ADMIN)
  approve(
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @Body() input: ApproveAccountTransactionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ledger.approve(transactionId, input, actor);
  }

  @Post('admin/account-transactions/:transactionId/retry-stripe-sync')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  retryStripeSync(@Param('transactionId', new ParseUUIDPipe()) transactionId: string) {
    return this.ledger.retryStripeSync(transactionId);
  }

  @Post('admin/account-transactions/:transactionId/reverse')
  @Roles(Role.SUPER_ADMIN)
  reverse(
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @Body() input: ReverseAccountTransactionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ledger.reverse(transactionId, input, actor);
  }
}
