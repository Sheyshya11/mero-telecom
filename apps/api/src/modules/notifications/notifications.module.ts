import { Module } from '@nestjs/common';

import { EmailProvider } from './email-provider';
import { EmailQueueService } from './email-queue.service';
import { NodemailerEmailProvider } from './nodemailer-email.provider';
import { NotificationService } from './notification.service';

@Module({
  providers: [
    NotificationService,
    EmailQueueService,
    { provide: EmailProvider, useClass: NodemailerEmailProvider },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
