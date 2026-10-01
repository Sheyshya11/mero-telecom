import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationController } from './notification.controller';
import { NotificationsModule } from './notifications.module';

@Module({
  imports: [AuthModule, AuthorizationModule, NotificationsModule],
  controllers: [NotificationController],
})
export class NotificationCentreModule {}
