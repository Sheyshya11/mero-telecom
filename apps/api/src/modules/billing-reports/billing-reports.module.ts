import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { BillingReportsController } from './billing-reports.controller';
import { BillingReportsService } from './billing-reports.service';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [BillingReportsController],
  providers: [BillingReportsService],
  exports: [BillingReportsService],
})
export class BillingReportsModule {}
