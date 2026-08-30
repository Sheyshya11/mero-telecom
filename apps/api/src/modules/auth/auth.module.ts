import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { NotificationsModule } from '../notifications/notifications.module';
import { AccountInvitationsService } from './account-invitations.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordResetService } from './password-reset.service';
import { TrustedOriginGuard } from './trusted-origin.guard';

@Module({
  imports: [JwtModule.register({}), NotificationsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccountInvitationsService,
    PasswordResetService,
    JwtAuthGuard,
    TrustedOriginGuard,
  ],
  exports: [AuthService, AccountInvitationsService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
