import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../../common/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { BillingReportsController } from './billing-reports.controller';
import { BillingReportsService } from './billing-reports.service';
import { BillingReportCalculationsService } from './services/billing-report-calculations.service';
import { BillingReportCsvService } from './services/billing-report-csv.service';
import { BillingReportPdfService } from './services/billing-report-pdf.service';
import { FinancialMetricsService } from './services/financial-metrics.service';
import { ReceivablesReportService } from './services/receivables-report.service';
import { ReconciliationReportService } from './services/reconciliation-report.service';
import { ReportPeriodService } from './services/report-period.service';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [BillingReportsController],
  providers: [
    BillingReportsService,
    BillingReportCalculationsService,
    BillingReportCsvService,
    BillingReportPdfService,
    FinancialMetricsService,
    ReceivablesReportService,
    ReconciliationReportService,
    ReportPeriodService,
  ],
  exports: [BillingReportsService],
})
export class BillingReportsModule {}
