import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { StripeModule } from '../payments/stripe.module';
import { AccountLedgerController } from './account-ledger.controller';
import { AccountLedgerService } from './account-ledger.service';

@Module({
  imports: [AuthModule, AuthorizationModule, StripeModule],
  controllers: [AccountLedgerController],
  providers: [AccountLedgerService],
  exports: [AccountLedgerService],
})
export class AccountLedgerModule {}
