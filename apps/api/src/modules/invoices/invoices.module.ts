import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../common/authorization.module';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InvoicesController } from './invoices.controller';
import { InvoiceEmailService } from './invoice-email.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [AuthModule, AuthorizationModule, BillingModule, NotificationsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicePdfService, InvoiceEmailService],
})
export class InvoicesModule {}
