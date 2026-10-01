import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationQueryDto } from './dto/notification.dto';
import { InAppNotificationService } from './in-app-notification.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER, Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN)
export class NotificationController {
  constructor(private readonly notifications: InAppNotificationService) {}

  @Get()
  findMine(@Query() query: NotificationQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.getUserNotifications(actor.id, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.getUnreadCount(actor.id);
  }

  @Patch('read-all')
  markAllAsRead(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.markAllAsRead(actor.id);
  }

  @Patch(':notificationId/read')
  markAsRead(
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.notifications.markAsRead(notificationId, actor.id);
  }

  @Delete(':notificationId')
  @HttpCode(204)
  async remove(
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.notifications.deleteNotification(notificationId, actor.id);
  }
}
