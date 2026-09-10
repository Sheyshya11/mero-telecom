import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PaymentStatus, Prisma, RefundStatus } from '@prisma/client';

import { hasBillingReportPermission } from '../../common/authorization/billing-report-permissions';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  BillingReportExportDocument,
  BillingReportExportMetadata,
  GeneratedBillingReportExport,
  ReportRow,
} from './billing-report-export.types';
import type { ResolvedReportPeriod } from './billing-report.types';
import { BillingReportType, type BillingReportQueryDto } from './dto/billing-report-query.dto';
import { BillingReportCalculationsService } from './services/billing-report-calculations.service';
import { BillingReportCsvService } from './services/billing-report-csv.service';
import { BillingReportPdfService } from './services/billing-report-pdf.service';
import {
  FinancialMetricsService,
  SETTLED_PAYMENT_STATUSES,
} from './services/financial-metrics.service';
import { ReceivablesReportService } from './services/receivables-report.service';
import { ReconciliationReportService } from './services/reconciliation-report.service';
import { ReportPeriodService } from './services/report-period.service';

@Injectable()
export class BillingReportsService {
  private readonly logger = new Logger(BillingReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly periods: ReportPeriodService,
    private readonly financialMetrics: FinancialMetricsService,
    private readonly calculations: BillingReportCalculationsService,
    private readonly receivablesReport: ReceivablesReportService,
    private readonly reconciliationReport: ReconciliationReportService,
    private readonly csvExporter: BillingReportCsvService,
    private readonly pdfExporter: BillingReportPdfService,
  ) {}

  assertCanView(actor: AuthenticatedUser): void {
    if (!hasBillingReportPermission(actor.role, 'billing.reports.view')) {
      throw new ForbiddenException('Billing reports require administrator access.');
    }
  }

  async summary(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const period = this.periods.resolve(query);
    const [overview, reconciliation] = await Promise.all([
      this.financialMetrics.overview(query, period),
      this.reconciliationReport.report({ ...query, page: 1, pageSize: 100 }, period),
    ]);
    return {
      period: this.periods.metadata(period),
      metricBasis: {
        periodMetrics: [
          'grossBilled',
          'paymentsReceived',
          'netCashCollected',
          'failedPayments',
          'refundsPaid',
          'creditsIssued',
        ],
        snapshotMetrics: ['outstanding', 'mrr', 'activeServices', 'arpu', 'overdueBalance'],
      },
      ...overview,
      metrics: {
        ...overview.metrics,
        unreconciledTransactions: this.calculations.count(reconciliation.summary.exceptionCount, 0),
      },
      unreconciledTransactions: reconciliation.summary.exceptionCount,
      reconciliationLastCompletedAt: reconciliation.summary.lastReconciledAt,
    };
  }

  async revenue(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const period = this.periods.resolve(query);
    const summary = await this.summary(query, actor);
    const groupBy = query.groupBy ?? this.periods.defaultGroupBy(period);
    const [invoices, payments, refunds] = await Promise.all([
      this.prisma.invoice.findMany({
        where: this.financialMetrics.issuedInvoiceWhere(query, period),
        select: { issuedAt: true, issueDate: true, totalCents: true },
      }),
      this.prisma.payment.findMany({
        where: this.financialMetrics.paymentWhere(query, period, true),
        select: { paidAt: true, amountCents: true },
      }),
      this.prisma.refund.findMany({
        where: this.financialMetrics.refundWhere(query, period),
        select: { processedAt: true, refundAmountCents: true },
      }),
    ]);
    const trend = new Map<
      string,
      {
        grossBilledCents: number;
        paymentsReceivedCents: number;
        refundsPaidCents: number;
        netCashCollectedCents: number;
      }
    >();
    const add = (
      date: Date,
      field: 'grossBilledCents' | 'paymentsReceivedCents' | 'refundsPaidCents',
      cents: number,
    ) => {
      const key = this.periods.bucket(date, groupBy, period.timezone);
      const current = trend.get(key) ?? {
        grossBilledCents: 0,
        paymentsReceivedCents: 0,
        refundsPaidCents: 0,
        netCashCollectedCents: 0,
      };
      current[field] += cents;
      current.netCashCollectedCents = current.paymentsReceivedCents - current.refundsPaidCents;
      trend.set(key, current);
    };
    for (const invoice of invoices) {
      add(invoice.issuedAt ?? invoice.issueDate, 'grossBilledCents', invoice.totalCents);
    }
    for (const payment of payments)
      if (payment.paidAt) add(payment.paidAt, 'paymentsReceivedCents', payment.amountCents);
    for (const refund of refunds)
      if (refund.processedAt) add(refund.processedAt, 'refundsPaidCents', refund.refundAmountCents);
    return {
      period: this.periods.metadata(period),
      summary,
      groupBy,
      trend: [...trend.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([bucket, values]) => ({ period: bucket, ...values })),
    };
  }

  async invoices(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const period = this.periods.resolve(query);
    const where = this.financialMetrics.issuedInvoiceWhere(query, period);
    const orderBy = this.invoiceOrderBy(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          customer: {
            select: { customerNumber: true, firstName: true, lastName: true, email: true },
          },
          subscription: { include: { plan: { select: { name: true } } } },
          purchasePlan: { select: { name: true } },
          payments: {
            where: { paidAt: { lt: period.to } },
            select: { amountCents: true, status: true, paidAt: true },
          },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      period: this.periods.metadata(period),
      data: rows.map((invoice) => ({
        invoiceNumber: invoice.invoiceNumber,
        customer: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
        customerEmail: invoice.customer.email,
        subscription: invoice.subscription?.id ?? null,
        plan: invoice.subscription?.plan.name ?? invoice.purchasePlan?.name ?? null,
        billingPeriod: invoice.issueDate.toISOString().slice(0, 10),
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        subtotalCents: invoice.subtotalCents,
        gstCents: invoice.taxCents,
        totalCents: invoice.totalCents,
        amountPaidCents: this.settledAmount(invoice.payments),
        amountDueCents: Math.max(0, invoice.totalCents - this.settledAmount(invoice.payments)),
        status: invoice.status,
        paidDate: invoice.paidAt,
      })),
      meta: this.meta(query, total),
    };
  }

  async payments(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const period = this.periods.resolve(query);
    const where: Prisma.PaymentWhereInput = {
      AND: [
        {
          OR: [
            { paidAt: { gte: period.from, lt: period.to } },
            { paidAt: null, createdAt: { gte: period.from, lt: period.to } },
          ],
        },
        ...(query.customerId ? [{ customerId: query.customerId }] : []),
        ...(query.paymentStatus ? [{ status: query.paymentStatus }] : []),
        ...(query.search
          ? [
              {
                OR: [
                  { providerPaymentId: { contains: query.search, mode: 'insensitive' as const } },
                  {
                    invoice: {
                      invoiceNumber: { contains: query.search, mode: 'insensitive' as const },
                    },
                  },
                  { customer: { email: { contains: query.search, mode: 'insensitive' as const } } },
                ],
              },
            ]
          : []),
      ],
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: this.paymentOrderBy(query),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          customer: { select: { firstName: true, lastName: true, email: true } },
          invoice: { select: { invoiceNumber: true } },
          refunds: { select: { refundAmountCents: true, status: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      period: this.periods.metadata(period),
      analytics: await this.paymentAnalytics(query, period),
      data: rows.map((payment) => ({
        paymentId: payment.id,
        invoiceNumber: payment.invoice.invoiceNumber,
        customer: `${payment.customer.firstName} ${payment.customer.lastName}`,
        customerEmail: payment.customer.email,
        amountCents: payment.amountCents,
        paymentMethod: payment.provider,
        status: payment.status,
        paymentDate: payment.paidAt ?? payment.createdAt,
        stripePaymentIntentId: payment.providerPaymentId,
        failureReason:
          payment.status === PaymentStatus.FAILED
            ? 'Unknown — the current payment record does not store a safe decline category.'
            : null,
        refundedCents: payment.refunds
          .filter((refund) => refund.status === RefundStatus.SUCCEEDED)
          .reduce((sum, refund) => sum + refund.refundAmountCents, 0),
      })),
      meta: this.meta(query, total),
    };
  }

  async receivables(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const period = this.periods.resolve(query);
    return {
      period: this.periods.metadata(period),
      ...(await this.receivablesReport.report(query, period)),
    };
  }

  async refunds(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const period = this.periods.resolve(query);
    const where: Prisma.RefundWhereInput = {
      AND: [
        {
          OR: [
            { processedAt: { gte: period.from, lt: period.to } },
            { processedAt: null, requestedAt: { gte: period.from, lt: period.to } },
          ],
        },
        ...(query.customerId ? [{ customerId: query.customerId }] : []),
        ...(query.refundStatus ? [{ status: query.refundStatus }] : []),
      ],
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.refund.findMany({
        where,
        orderBy: { requestedAt: query.sortDirection },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          customer: { select: { firstName: true, lastName: true, email: true } },
          invoice: { select: { invoiceNumber: true } },
          payment: { select: { id: true } },
          requestedBy: { select: { displayName: true, email: true } },
          approvedBy: { select: { displayName: true, email: true } },
        },
      }),
      this.prisma.refund.count({ where }),
    ]);
    return {
      period: this.periods.metadata(period),
      analytics: await this.refundAnalytics(query, period),
      data: rows.map((refund) => ({
        refundId: refund.id,
        customer: `${refund.customer.firstName} ${refund.customer.lastName}`,
        customerEmail: refund.customer.email,
        invoiceNumber: refund.invoice?.invoiceNumber ?? null,
        paymentId: refund.payment.id,
        refundAmountCents: refund.refundAmountCents,
        reason: refund.reason,
        requestedDate: refund.requestedAt,
        requestedBy: refund.requestedBy?.displayName ?? refund.requestedBy?.email ?? null,
        approvedBy: refund.approvedBy?.displayName ?? refund.approvedBy?.email ?? null,
        approvalDate: refund.approvedAt,
        status: refund.status,
        stripeRefundId: refund.stripeRefundId,
        completedDate: refund.processedAt,
      })),
      meta: this.meta(query, total),
    };
  }

  async subscriptions(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const period = this.periods.resolve(query);
    const [plans, invoiceRows] = await Promise.all([
      this.prisma.internetPlan.findMany({
        where: query.planId ? { id: query.planId } : undefined,
        select: {
          id: true,
          name: true,
          monthlyCents: true,
          subscriptions: {
            where: {
              startDate: { lt: period.to },
              OR: [
                { status: 'ACTIVE', endDate: null },
                {
                  status: 'ACTIVE',
                  endDate: { gte: new Date(`${period.toLocalDate}T00:00:00.000Z`) },
                },
                {
                  status: 'CANCELLED',
                  endDate: { gte: new Date(`${period.toLocalDate}T00:00:00.000Z`) },
                },
              ],
            },
            select: { id: true },
          },
        },
      }),
      this.prisma.invoice.findMany({
        where: this.financialMetrics.issuedInvoiceWhere(query, period),
        select: {
          id: true,
          purchasePlanId: true,
          subscription: { select: { planId: true } },
          totalCents: true,
          payments: {
            where: {
              status: { in: SETTLED_PAYMENT_STATUSES },
              paidAt: { gte: period.from, lt: period.to },
            },
            select: { amountCents: true },
          },
          refunds: {
            where: {
              status: RefundStatus.SUCCEEDED,
              processedAt: { gte: period.from, lt: period.to },
            },
            select: { refundAmountCents: true },
          },
        },
      }),
    ]);
    const totalActive = plans.reduce((sum, plan) => sum + plan.subscriptions.length, 0);
    const data = plans.map((plan) => {
      const activeServices = plan.subscriptions.length;
      const mrrCents =
        activeServices *
        (plan.monthlyCents - this.calculations.gstFromInclusive(plan.monthlyCents));
      const allInvoices = invoiceRows.filter(
        (invoice) => (invoice.purchasePlanId ?? invoice.subscription?.planId) === plan.id,
      );
      const grossBilledCents = allInvoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
      const collectedCents = allInvoices.reduce(
        (sum, invoice) =>
          sum + invoice.payments.reduce((subtotal, payment) => subtotal + payment.amountCents, 0),
        0,
      );
      const refundsCents = allInvoices.reduce(
        (sum, invoice) =>
          sum +
          invoice.refunds.reduce((subtotal, refund) => subtotal + refund.refundAmountCents, 0),
        0,
      );
      return {
        planId: plan.id,
        planName: plan.name,
        activeServices,
        percentageOfActiveServices:
          totalActive === 0 ? 0 : Math.round((activeServices / totalActive) * 10_000) / 100,
        mrrCents,
        arpuCents: this.calculations.arpu(mrrCents, activeServices),
        grossBilledCents,
        collectedCents,
        refundsCents,
        wholesaleCostCents: null,
        grossContributionCents: null,
        grossMarginPercentage: null,
      };
    });
    const start = (query.page - 1) * query.pageSize;
    return {
      period: this.periods.metadata(period),
      data: data.slice(start, start + query.pageSize),
      meta: this.meta(query, data.length),
      wholesaleCostStatus: 'NOT_CONFIGURED',
    };
  }

  async reconciliation(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    if (!hasBillingReportPermission(actor.role, 'billing.reconciliation.view')) {
      throw new ForbiddenException('You do not have permission to view reconciliation reports.');
    }
    const period = this.periods.resolve(query);
    await this.recordAudit(actor, 'BILLING_RECONCILIATION_VIEWED', 'reconciliation', {
      filters: this.auditFilters(query),
    });
    return {
      period: this.periods.metadata(period),
      ...(await this.reconciliationReport.report(query, period)),
    };
  }

  private async paymentAnalytics(query: BillingReportQueryDto, period: ResolvedReportPeriod) {
    const [successful, failedCount] = await Promise.all([
      this.prisma.payment.findMany({
        where: this.financialMetrics.paymentWhere(
          { ...query, paymentStatus: undefined },
          period,
          true,
        ),
        select: { amountCents: true },
      }),
      this.prisma.payment.count({
        where: {
          ...this.financialMetrics.paymentWhere(
            { ...query, paymentStatus: undefined },
            period,
            false,
          ),
          status: PaymentStatus.FAILED,
        },
      }),
    ]);
    const successfulValueCents = successful.reduce((sum, payment) => sum + payment.amountCents, 0);
    return {
      successfulPaymentCount: successful.length,
      successfulPaymentValueCents: successfulValueCents,
      failedPaymentCount: failedCount,
      paymentSuccessRate: this.calculations.successRate(successful.length, failedCount),
      averagePaymentValueCents:
        successful.length === 0 ? 0 : Math.round(successfulValueCents / successful.length),
      failuresByReason:
        failedCount === 0
          ? []
          : [
              {
                reason: 'UNKNOWN',
                count: failedCount,
                note: 'The current Payment model does not persist a safe Stripe decline category.',
              },
            ],
    };
  }

  private async refundAnalytics(query: BillingReportQueryDto, period: ResolvedReportPeriod) {
    const [refunds, credits, payments] = await Promise.all([
      this.prisma.refund.findMany({
        where: this.financialMetrics.refundWhere({ ...query, refundStatus: undefined }, period),
        select: { refundAmountCents: true },
      }),
      this.prisma.planChangeRequest.findMany({
        where: {
          status: 'APPLIED',
          unusedCreditCents: { gt: 0 },
          appliedAt: { gte: period.from, lt: period.to },
          ...(query.customerId ? { customerId: query.customerId } : {}),
        },
        select: { unusedCreditCents: true },
      }),
      this.prisma.payment.findMany({
        where: this.financialMetrics.paymentWhere(
          { ...query, paymentStatus: undefined },
          period,
          true,
        ),
        select: { amountCents: true },
      }),
    ]);
    const refundAmountCents = refunds.reduce((sum, row) => sum + row.refundAmountCents, 0);
    const creditAmountCents = credits.reduce((sum, row) => sum + row.unusedCreditCents, 0);
    const paymentAmountCents = payments.reduce((sum, row) => sum + row.amountCents, 0);
    return {
      refundCount: refunds.length,
      refundAmountCents,
      creditCount: credits.length,
      creditAmountCents,
      averageRefundCents: refunds.length === 0 ? 0 : Math.round(refundAmountCents / refunds.length),
      refundRatePercentage:
        paymentAmountCents === 0
          ? null
          : Math.round((refundAmountCents / paymentAmountCents) * 10_000) / 100,
    };
  }

  async export(
    reportType: BillingReportType,
    query: BillingReportQueryDto,
    actor: AuthenticatedUser,
    format: 'csv' | 'pdf' | 'xlsx',
  ): Promise<GeneratedBillingReportExport> {
    this.assertCanView(actor);
    if (!hasBillingReportPermission(actor.role, 'billing.reports.export')) {
      throw new ForbiddenException('You do not have permission to export billing reports.');
    }
    const exportQuery = { ...query, page: 1, pageSize: 10_000 };
    const report = await this.report(reportType, exportQuery, actor);
    const rows = this.rows(report);
    const period = this.periods.resolve(query);
    const metadata: BillingReportExportMetadata = {
      organisation: 'Mero Telecom',
      reportType,
      reportName: this.reportName(reportType),
      reportId: this.reportId(reportType, period.generatedAt),
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      fromLocalDate: period.fromLocalDate,
      toLocalDate: period.toLocalDate,
      timezone: period.timezone,
      generatedAt: period.generatedAt.toISOString(),
      generatedBy: actor.email,
      currency: 'AUD',
      activeFilters: this.auditFilters(query),
    };
    await this.recordAudit(actor, 'BILLING_REPORT_EXPORTED', reportType, {
      reportType,
      format,
      filters: this.auditFilters(query),
    });
    const fileName = this.exportFileName(reportType, period, format);
    if (format === 'pdf') {
      const revenue =
        reportType === BillingReportType.REVENUE ? report : await this.revenue(exportQuery, actor);
      const plans =
        reportType === BillingReportType.SUBSCRIPTIONS
          ? report
          : await this.subscriptions(exportQuery, actor);
      const revenueRecord = this.asRecord(revenue);
      const document: BillingReportExportDocument = {
        metadata,
        report,
        rows,
        overview: revenueRecord.summary ?? {},
        revenue,
        plans,
      };
      return {
        buffer: await this.pdfExporter.render(document),
        contentType: 'application/pdf',
        extension: 'pdf',
        fileName,
      };
    }
    if (format === 'xlsx')
      return {
        buffer: this.xlsx(rows, {
          organisation: metadata.organisation,
          report: metadata.reportType,
          from: metadata.from,
          to: metadata.to,
          timezone: metadata.timezone,
          generatedAt: metadata.generatedAt,
          generatedBy: metadata.generatedBy,
          activeFilters: JSON.stringify(metadata.activeFilters),
        }),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
        fileName,
      };
    return {
      buffer: this.csvExporter.render(reportType, rows, period.timezone),
      contentType: 'text/csv; charset=utf-8',
      extension: 'csv',
      fileName,
    };
  }

  private report(
    type: BillingReportType,
    query: BillingReportQueryDto,
    actor: AuthenticatedUser,
  ): Promise<unknown> {
    switch (type) {
      case BillingReportType.REVENUE:
        return this.revenue(query, actor);
      case BillingReportType.INVOICES:
        return this.invoices(query, actor);
      case BillingReportType.PAYMENTS:
        return this.payments(query, actor);
      case BillingReportType.RECEIVABLES:
        return this.receivables(query, actor);
      case BillingReportType.REFUNDS:
        return this.refunds(query, actor);
      case BillingReportType.SUBSCRIPTIONS:
        return this.subscriptions(query, actor);
      case BillingReportType.RECONCILIATION:
        return this.reconciliation(query, actor);
    }
  }

  private rows(report: unknown): ReportRow[] {
    if (typeof report !== 'object' || report === null) return [];
    if ('data' in report && Array.isArray(report.data)) return report.data as ReportRow[];
    if ('trend' in report && Array.isArray(report.trend)) return report.trend as ReportRow[];
    if ('summary' in report && typeof report.summary === 'object' && report.summary !== null)
      return [report.summary as ReportRow];
    return [];
  }

  private async recordAudit(
    actor: AuthenticatedUser,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: actor.id,
          action,
          entityType: 'BillingReport',
          entityId,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'billing_report_audit_failed',
          action,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  private auditFilters(query: BillingReportQueryDto): Record<string, string | number> {
    return Object.fromEntries(
      Object.entries(query).filter(
        (entry): entry is [string, string | number] =>
          typeof entry[1] === 'string' || typeof entry[1] === 'number',
      ),
    );
  }

  private xlsx(rows: ReportRow[], metadata: ReportRow): Buffer {
    const columns = rows.length
      ? [...new Set(rows.flatMap((row) => Object.keys(row)))]
      : ['No data'];
    const escape = (value: unknown) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const worksheet = (allRows: unknown[][]) =>
      allRows
        .map(
          (row, index) =>
            `<row r="${index + 1}">${row.map((value, column) => `<c r="${this.columnName(column + 1)}${index + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`,
        )
        .join('');
    const reportSheet = worksheet([
      columns,
      ...rows.map((row) => columns.map((column) => row[column] ?? '')),
    ]);
    const metadataSheet = worksheet(
      Object.entries(metadata).map(([key, value]) => [key, value ?? '']),
    );
    return this.zip({
      '[Content_Types].xml':
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/><sheet name="Metadata" sheetId="2" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${reportSheet}</sheetData></worksheet>`,
      'xl/worksheets/sheet2.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${metadataSheet}</sheetData></worksheet>`,
    });
  }

  private columnName(index: number): string {
    let value = index;
    let result = '';
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }

  private zip(files: Record<string, string>): Buffer {
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, value] of Object.entries(files)) {
      const data = Buffer.from(value);
      const nameBuffer = Buffer.from(name);
      const crc = this.crc32(data);
      const local = Buffer.alloc(30 + nameBuffer.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBuffer.length, 26);
      nameBuffer.copy(local, 30);
      chunks.push(local, data);
      const entry = Buffer.alloc(46 + nameBuffer.length);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt32LE(crc, 16);
      entry.writeUInt32LE(data.length, 24);
      entry.writeUInt32LE(data.length, 20);
      entry.writeUInt16LE(nameBuffer.length, 28);
      entry.writeUInt32LE(offset, 42);
      nameBuffer.copy(entry, 46);
      central.push(entry);
      offset += local.length + data.length;
    }
    const centralData = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(centralData.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, centralData, end]);
  }

  private crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private reportName(type: BillingReportType): string {
    const names: Record<BillingReportType, string> = {
      [BillingReportType.REVENUE]: 'Billing & Revenue Report',
      [BillingReportType.INVOICES]: 'Invoice Report',
      [BillingReportType.PAYMENTS]: 'Payment Report',
      [BillingReportType.RECEIVABLES]: 'Receivables Report',
      [BillingReportType.REFUNDS]: 'Refund Report',
      [BillingReportType.SUBSCRIPTIONS]: 'Revenue by Plan Report',
      [BillingReportType.RECONCILIATION]: 'Payment Reconciliation Report',
    };
    return names[type];
  }

  private reportId(type: BillingReportType, generatedAt: Date): string {
    const timestamp = generatedAt
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
    return `MT-${type.toUpperCase()}-${timestamp}`;
  }

  private exportFileName(
    type: BillingReportType,
    period: ResolvedReportPeriod,
    extension: 'csv' | 'pdf' | 'xlsx',
  ): string {
    const slugs: Record<BillingReportType, string> = {
      [BillingReportType.REVENUE]: 'revenue',
      [BillingReportType.INVOICES]: 'billing',
      [BillingReportType.PAYMENTS]: 'payments',
      [BillingReportType.RECEIVABLES]: 'receivables',
      [BillingReportType.REFUNDS]: 'refunds',
      [BillingReportType.SUBSCRIPTIONS]: 'revenue-by-plan',
      [BillingReportType.RECONCILIATION]: 'payment-reconciliation',
    };
    const from = period.fromLocalDate;
    const to = period.toLocalDate;
    const [year, month, day] = from.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const fullMonth = day === 1 && to === `${from.slice(0, 8)}${String(lastDay).padStart(2, '0')}`;
    const range = fullMonth ? from.slice(0, 7) : `${from}-to-${to}`;
    return `mero-telecom-${slugs[type]}-report-${range}.${extension}`.replace(
      /[^a-zA-Z0-9._-]/g,
      '-',
    );
  }

  private invoiceOrderBy(query: BillingReportQueryDto): Prisma.InvoiceOrderByWithRelationInput {
    const direction = query.sortDirection;
    switch (query.sortBy) {
      case 'amount':
        return { totalCents: direction };
      case 'dueDate':
        return { dueDate: direction };
      case 'status':
        return { status: direction };
      case 'invoiceNumber':
        return { invoiceNumber: direction };
      default:
        return { issueDate: direction };
    }
  }

  private paymentOrderBy(query: BillingReportQueryDto): Prisma.PaymentOrderByWithRelationInput {
    return query.sortBy === 'amount'
      ? { amountCents: query.sortDirection }
      : { createdAt: query.sortDirection };
  }

  private settledAmount(payments: Array<{ amountCents: number; status: PaymentStatus }>): number {
    return payments
      .filter((payment) => SETTLED_PAYMENT_STATUSES.includes(payment.status))
      .reduce((sum, payment) => sum + payment.amountCents, 0);
  }

  private meta(query: BillingReportQueryDto, total: number) {
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
}
