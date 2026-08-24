import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { CoverageModule } from '../coverage/coverage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeModule } from './stripe.module';
import { PlanChangesModule } from '../plan-changes/plan-changes.module';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    BillingModule,
    CoverageModule,
    NotificationsModule,
    StripeModule,
    PlanChangesModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
