import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../../common/authorization.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OverdueLifecycleSchedulerService } from './overdue-lifecycle-scheduler.service';
import { PaymentEligibilityService } from './payment-eligibility.service';
import { ProvisioningService } from './provisioning.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
@Module({
  imports: [AuthModule, AuthorizationModule, NotificationsModule],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    SubscriptionLifecycleService,
    PaymentEligibilityService,
    ProvisioningService,
    OverdueLifecycleSchedulerService,
  ],
  exports: [SubscriptionLifecycleService, PaymentEligibilityService],
})
export class SubscriptionsModule {}
