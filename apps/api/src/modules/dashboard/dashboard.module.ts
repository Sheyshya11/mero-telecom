import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
