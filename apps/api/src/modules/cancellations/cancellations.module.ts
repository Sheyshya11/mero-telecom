import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CancellationReconciliationSchedulerService } from './cancellation-reconciliation-scheduler.service';
import { CancellationWorkflowPolicyService } from './cancellation-workflow-policy.service';
import {
  CustomerCancellationsController,
  OperationsCancellationsController,
} from './cancellations.controller';
import { CancellationsService } from './cancellations.service';
import { MockNbnProvider } from './providers/mock-nbn.provider';
import { WholesaleDisconnectionProvider } from './providers/wholesale-disconnection.provider';

@Module({
  imports: [AuthModule, AuthorizationModule, NotificationsModule],
  controllers: [CustomerCancellationsController, OperationsCancellationsController],
  providers: [
    CancellationsService,
    CancellationWorkflowPolicyService,
    CancellationReconciliationSchedulerService,
    { provide: WholesaleDisconnectionProvider, useClass: MockNbnProvider },
  ],
  exports: [CancellationsService],
})
export class CancellationsModule {}
