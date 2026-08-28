import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminBootstrapWarningService } from './admin-bootstrap-warning.service';
import { StaffInvitationsService } from './staff-invitations.service';
import {
  StaffInvitationAcceptanceController,
  SecurityAuditController,
  SystemUsersController,
} from './system-users.controller';
import { SystemUsersService } from './system-users.service';
import { SystemUserPolicyService } from './system-user-policy.service';

@Module({
  imports: [AuthModule, AuthorizationModule, NotificationsModule],
  controllers: [
    SystemUsersController,
    SecurityAuditController,
    StaffInvitationAcceptanceController,
  ],
  providers: [
    SystemUsersService,
    SystemUserPolicyService,
    StaffInvitationsService,
    AdminBootstrapWarningService,
  ],
  exports: [StaffInvitationsService],
})
export class SystemUsersModule {}
