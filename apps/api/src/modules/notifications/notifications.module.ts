import { Module } from '@nestjs/common';

import { EmailProvider } from './email-provider';
import { NodemailerEmailProvider } from './nodemailer-email.provider';
import { NotificationService } from './notification.service';

@Module({
  providers: [NotificationService, { provide: EmailProvider, useClass: NodemailerEmailProvider }],
  exports: [NotificationService],
})
export class NotificationsModule {}
