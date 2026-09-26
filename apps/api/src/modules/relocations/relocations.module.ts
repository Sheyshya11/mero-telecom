import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { CoverageModule } from '../coverage/coverage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MockRelocationProvider } from './providers/mock-relocation.provider';
import { ServiceRelocationProvider } from './providers/service-relocation.provider';
import { RelocationReconciliationSchedulerService } from './relocation-reconciliation-scheduler.service';
import { RelocationsController, SubscriptionRelocationsController } from './relocations.controller';
import { RelocationsService } from './relocations.service';

@Module({
  imports: [AuthModule, AuthorizationModule, CoverageModule, NotificationsModule],
  controllers: [SubscriptionRelocationsController, RelocationsController],
  providers: [
    RelocationsService,
    RelocationReconciliationSchedulerService,
    { provide: ServiceRelocationProvider, useClass: MockRelocationProvider },
  ],
  exports: [RelocationsService],
})
export class RelocationsModule {}
