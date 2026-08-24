import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StripeModule } from '../payments/stripe.module';
import {
  PlanChangeRequestsController,
  SubscriptionPlanChangesController,
} from './plan-changes.controller';
import { PlanChangeSchedulerService } from './plan-change-scheduler.service';
import { PlanChangesService } from './plan-changes.service';

@Module({
  imports: [AuthModule, AuthorizationModule, BillingModule, NotificationsModule, StripeModule],
  controllers: [SubscriptionPlanChangesController, PlanChangeRequestsController],
  providers: [PlanChangesService, PlanChangeSchedulerService],
  exports: [PlanChangesService],
})
export class PlanChangesModule {}
