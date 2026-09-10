import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { PrivateFilesModule } from '../../common/files/private-files.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupportAttachmentsService } from './support-attachments.service';
import {
  CustomerSupportController,
  PublicSupportController,
  StaffSupportController,
  SupportAttachmentAccessController,
} from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [AuthModule, AuthorizationModule, NotificationsModule, PrivateFilesModule],
  controllers: [
    CustomerSupportController,
    PublicSupportController,
    StaffSupportController,
    SupportAttachmentAccessController,
  ],
  providers: [SupportService, SupportAttachmentsService],
  exports: [SupportService],
})
export class SupportModule {}
