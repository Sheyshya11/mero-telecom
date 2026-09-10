import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { PrivateFilesModule } from '../../common/files/private-files.module';
import { AuthModule } from '../auth/auth.module';
import { CacheModule } from '../cache/cache.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StripeModule } from '../payments/stripe.module';
import {
  AdminRefundsController,
  CustomerRefundsController,
  RefundAttachmentAccessController,
} from './refunds.controller';
import { RefundPolicyService } from './refund-policy.service';
import { RefundReconciliationService } from './refund-reconciliation.service';
import { RefundReconciliationSchedulerService } from './refund-reconciliation-scheduler.service';
import { RefundsService } from './refunds.service';
import { StripeRefundService } from './stripe-refund.service';
import { RefundAttachmentStorageService } from './refund-attachment-storage.service';
import { RefundAttachmentsService } from './refund-attachments.service';
import { RefundFileSecurityService } from './refund-file-security.service';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    CacheModule,
    NotificationsModule,
    PrivateFilesModule,
    StripeModule,
  ],
  controllers: [
    CustomerRefundsController,
    AdminRefundsController,
    RefundAttachmentAccessController,
  ],
  providers: [
    RefundsService,
    RefundPolicyService,
    RefundReconciliationService,
    RefundReconciliationSchedulerService,
    StripeRefundService,
    RefundAttachmentStorageService,
    RefundAttachmentsService,
    RefundFileSecurityService,
  ],
  exports: [RefundsService, RefundReconciliationService],
})
export class RefundsModule {}
