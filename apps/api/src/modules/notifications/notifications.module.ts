import { Module } from '@nestjs/common';

import { EmailProvider } from './email-provider';
import { EmailQueueService } from './email-queue.service';
import { InAppNotificationService } from './in-app-notification.service';
import { NodemailerEmailProvider } from './nodemailer-email.provider';
import { NotificationService } from './notification.service';

@Module({
  providers: [
    NotificationService,
    InAppNotificationService,
    EmailQueueService,
    { provide: EmailProvider, useClass: NodemailerEmailProvider },
  ],
  exports: [NotificationService, InAppNotificationService],
})
export class NotificationsModule {}
