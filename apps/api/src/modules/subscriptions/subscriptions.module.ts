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
import { StripeModule } from '../payments/stripe.module';
@Module({
  imports: [AuthModule, AuthorizationModule, NotificationsModule, StripeModule],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    SubscriptionLifecycleService,
    PaymentEligibilityService,
    ProvisioningService,
    OverdueLifecycleSchedulerService,
  ],
  exports: [SubscriptionLifecycleService, PaymentEligibilityService, ProvisioningService],
})
export class SubscriptionsModule {}
