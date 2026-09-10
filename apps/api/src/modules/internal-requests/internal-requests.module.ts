import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { PrivateFilesModule } from '../../common/files/private-files.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  AdminInternalRequestsController,
  InternalRequestAttachmentAccessController,
  StaffInternalRequestsController,
  SuperAdminInternalRequestsController,
} from './internal-requests.controller';
import { InternalRequestAttachmentsService } from './internal-request-attachments.service';
import { InternalRequestsService } from './internal-requests.service';

@Module({
  imports: [AuthModule, AuthorizationModule, NotificationsModule, PrivateFilesModule],
  controllers: [
    StaffInternalRequestsController,
    AdminInternalRequestsController,
    SuperAdminInternalRequestsController,
    InternalRequestAttachmentAccessController,
  ],
  providers: [InternalRequestsService, InternalRequestAttachmentsService],
  exports: [InternalRequestsService],
})
export class InternalRequestsModule {}
