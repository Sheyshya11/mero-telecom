import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  SubscriptionStatus,
} from '@prisma/client';
import PDFDocument from 'pdfkit';

import { hasBillingReportPermission } from '../../common/authorization/billing-report-permissions';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  BillingReportType,
  type BillingReportQueryDto,
  RevenueGroupBy,
} from './dto/billing-report-query.dto';

type ReportRange = { from: Date; to: Date };
type ReportRow = Record<string, string | number | null>;
type Summary = {
  period: { from: string; to: string };
  totalInvoices: number;
  grossAmountCents: number;
  paymentsReceivedCents: number;
  outstandingBalanceCents: number;
  refundAmountCents: number;
  creditsAppliedCents: number;
  discountsCents: number;
  gstCollectedCents: number;
  netRevenueCents: number;
  paidInvoices: number;
  overdueInvoices: number;
  failedPayments: number;
  activeSubscriptions: number;
};

const settledPaymentStatuses: PaymentStatus[] = [
  PaymentStatus.SUCCEEDED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];
const openInvoiceStatuses: InvoiceStatus[] = [
  InvoiceStatus.DRAFT,
  InvoiceStatus.ISSUED,
  InvoiceStatus.OVERDUE,
];

@Injectable()
export class BillingReportsService {
  private readonly logger = new Logger(BillingReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  assertCanView(actor: AuthenticatedUser): void {
    if (!hasBillingReportPermission(actor.role, 'billing.reports.view')) {
      throw new ForbiddenException('Billing reports require administrator access.');
    }
  }

  async summary(query: BillingReportQueryDto, actor: AuthenticatedUser): Promise<Summary> {
    this.assertCanView(actor);
    const range = this.range(query);
    const invoiceWhere = this.invoiceWhere(query, range);
    const [
      invoices,
      payments,
      refunds,
      activeSubscriptions,
      paidInvoices,
      overdueInvoices,
      failedPayments,
    ] = await Promise.all([
      this.prisma.invoice.findMany({
        where: invoiceWhere,
        select: {
          subtotalCents: true,
          taxCents: true,
          totalCents: true,
          status: true,
          payments: { select: { amountCents: true, status: true } },
        },
      }),
      this.prisma.payment.aggregate({
        where: this.paymentWhere(query, range, { status: { in: settledPaymentStatuses } }),
        _sum: { amountCents: true },
      }),
      this.prisma.refund.aggregate({
        where: this.refundWhere(query, range, RefundStatus.SUCCEEDED),
        _sum: { refundAmountCents: true },
      }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.invoice.count({ where: { ...invoiceWhere, status: InvoiceStatus.PAID } }),
      this.prisma.invoice.count({ where: { ...invoiceWhere, status: InvoiceStatus.OVERDUE } }),
      this.prisma.payment.count({
        where: this.paymentWhere(query, range, { status: PaymentStatus.FAILED }),
      }),
    ]);
    const grossAmountCents = invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
    const outstandingBalanceCents = invoices
      .filter((invoice) => openInvoiceStatuses.includes(invoice.status))
      .reduce(
        (sum, invoice) =>
          sum + Math.max(0, invoice.totalCents - this.settledAmount(invoice.payments)),
        0,
      );
    const paymentsReceivedCents = payments._sum.amountCents ?? 0;
    const refundAmountCents = refunds._sum.refundAmountCents ?? 0;
    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      totalInvoices: invoices.length,
      grossAmountCents,
      paymentsReceivedCents,
      outstandingBalanceCents,
      refundAmountCents,
      creditsAppliedCents: 0,
      discountsCents: 0,
      gstCollectedCents: invoices.reduce((sum, invoice) => sum + invoice.taxCents, 0),
      netRevenueCents: paymentsReceivedCents - refundAmountCents,
      paidInvoices,
      overdueInvoices,
      failedPayments,
      activeSubscriptions,
    };
  }

  async revenue(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const range = this.range(query);
    const summary = await this.summary(query, actor);
    const invoices = await this.prisma.invoice.findMany({
      where: this.invoiceWhere(query, range),
      select: { issueDate: true, totalCents: true, taxCents: true },
      orderBy: { issueDate: 'asc' },
    });
    const groupBy = query.groupBy ?? this.defaultGroupBy(range);
    const trend = new Map<string, { grossCents: number; gstCents: number }>();
    for (const invoice of invoices) {
      const key = this.bucket(invoice.issueDate, groupBy);
      const current = trend.get(key) ?? { grossCents: 0, gstCents: 0 };
      current.grossCents += invoice.totalCents;
      current.gstCents += invoice.taxCents;
      trend.set(key, current);
    }
    return {
      summary,
      groupBy,
      trend: [...trend.entries()].map(([period, values]) => ({ period, ...values })),
    };
  }

  async invoices(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const range = this.range(query);
    const where = this.invoiceWhere(query, range);
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
          payments: { select: { amountCents: true, status: true, paidAt: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      data: rows.map((invoice) => ({
        invoiceNumber: invoice.invoiceNumber,
        customer: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
        customerEmail: invoice.customer.email,
        subscription: invoice.subscription?.id ?? null,
        plan: invoice.subscription?.plan.name ?? invoice.purchasePlanId,
        billingPeriod: invoice.issueDate.toISOString().slice(0, 10),
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        subtotalCents: invoice.subtotalCents,
        discountCents: 0,
        creditCents: 0,
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
    const range = this.range(query);
    const where = this.paymentWhere(query, range);
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
        stripeChargeId: null,
        failureReason: payment.status === PaymentStatus.FAILED ? 'Payment failed' : null,
        refundedCents: payment.refunds
          .filter((refund) => refund.status === RefundStatus.SUCCEEDED)
          .reduce((sum, refund) => sum + refund.refundAmountCents, 0),
      })),
      meta: this.meta(query, total),
    };
  }

  async receivables(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const range = this.range(query);
    const invoices = await this.prisma.invoice.findMany({
      where: { ...this.invoiceWhere(query, range), status: { in: openInvoiceStatuses } },
      include: {
        customer: { select: { customerNumber: true, firstName: true, lastName: true } },
        payments: { select: { amountCents: true, status: true } },
      },
    });
    const rows = new Map<string, ReportRow>();
    for (const invoice of invoices) {
      const outstanding = Math.max(0, invoice.totalCents - this.settledAmount(invoice.payments));
      if (!outstanding) continue;
      const customerKey = invoice.customer.customerNumber;
      const row = rows.get(customerKey) ?? {
        customer: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
        customerNumber: customerKey,
        currentCents: 0,
        overdue1To30Cents: 0,
        overdue31To60Cents: 0,
        overdue61To90Cents: 0,
        overdue90PlusCents: 0,
        totalOutstandingCents: 0,
      };
      const days = Math.floor((Date.now() - invoice.dueDate.getTime()) / 86_400_000);
      const bucket =
        days <= 0
          ? 'currentCents'
          : days <= 30
            ? 'overdue1To30Cents'
            : days <= 60
              ? 'overdue31To60Cents'
              : days <= 90
                ? 'overdue61To90Cents'
                : 'overdue90PlusCents';
      row[bucket] = Number(row[bucket] ?? 0) + outstanding;
      row.totalOutstandingCents = Number(row.totalOutstandingCents) + outstanding;
      rows.set(customerKey, row);
    }
    const data = [...rows.values()].sort(
      (a, b) => Number(b.totalOutstandingCents) - Number(a.totalOutstandingCents),
    );
    const start = (query.page - 1) * query.pageSize;
    const receivableTotals: Record<string, number> = {
      currentCents: 0,
      overdue1To30Cents: 0,
      overdue31To60Cents: 0,
      overdue61To90Cents: 0,
      overdue90PlusCents: 0,
      totalOutstandingCents: 0,
    };
    const totals = data.reduce<Record<string, number>>((result, row) => {
      for (const key of Object.keys(result))
        result[key] = (result[key] ?? 0) + Number(row[key] ?? 0);
      return result;
    }, receivableTotals);
    return {
      data: data.slice(start, start + query.pageSize),
      meta: this.meta(query, data.length),
      totals,
    };
  }

  async refunds(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const range = this.range(query);
    const where = this.refundWhere(query, range);
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
        internalCreditCents: 0,
        creditReason: null,
      })),
      meta: this.meta(query, total),
    };
  }

  async subscriptions(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    const range = this.range(query);
    const plans = await this.prisma.internetPlan.findMany({
      where: query.planId ? { id: query.planId } : undefined,
      include: {
        subscriptions: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            customerId: true,
            refunds: {
              where: {
                status: RefundStatus.SUCCEEDED,
                processedAt: { gte: range.from, lt: range.to },
              },
              select: { refundAmountCents: true },
            },
          },
        },
        purchaseInvoices: {
          where: { issueDate: { gte: range.from, lt: range.to } },
          select: { totalCents: true },
        },
        targetPlanChanges: {
          where: { requestedAt: { gte: range.from, lt: range.to } },
          select: { type: true, status: true, unusedCreditCents: true },
        },
      },
    });
    const data = plans.map((plan) => ({
      planName: plan.name,
      activeSubscriptions: plan.subscriptions.filter(
        (subscription) => subscription.status === SubscriptionStatus.ACTIVE,
      ).length,
      newSubscriptions: plan.subscriptions.filter(
        (subscription) => subscription.createdAt >= range.from && subscription.createdAt < range.to,
      ).length,
      upgrades: plan.targetPlanChanges.filter(
        (change) => change.type === 'UPGRADE' && change.status === 'APPLIED',
      ).length,
      downgrades: plan.targetPlanChanges.filter(
        (change) => change.type === 'DOWNGRADE' && change.status === 'APPLIED',
      ).length,
      cancellations: plan.subscriptions.filter(
        (subscription) => subscription.status === SubscriptionStatus.CANCELLED,
      ).length,
      grossRevenueCents: plan.purchaseInvoices.reduce(
        (sum, invoice) => sum + invoice.totalCents,
        0,
      ),
      refundsCents: plan.subscriptions.reduce(
        (sum, subscription) =>
          sum +
          subscription.refunds.reduce((refunds, refund) => refunds + refund.refundAmountCents, 0),
        0,
      ),
      creditsCents: plan.targetPlanChanges.reduce(
        (sum, change) => sum + change.unusedCreditCents,
        0,
      ),
      netRevenueCents:
        plan.purchaseInvoices.reduce((sum, invoice) => sum + invoice.totalCents, 0) -
        plan.subscriptions.reduce(
          (sum, subscription) =>
            sum +
            subscription.refunds.reduce((refunds, refund) => refunds + refund.refundAmountCents, 0),
          0,
        ) -
        plan.targetPlanChanges.reduce((sum, change) => sum + change.unusedCreditCents, 0),
      averageRevenuePerActiveSubscriptionCents: plan.subscriptions.filter(
        (subscription) => subscription.status === SubscriptionStatus.ACTIVE,
      ).length
        ? Math.round(
            plan.purchaseInvoices.reduce((sum, invoice) => sum + invoice.totalCents, 0) /
              plan.subscriptions.filter(
                (subscription) => subscription.status === SubscriptionStatus.ACTIVE,
              ).length,
          )
        : 0,
    }));
    return { data, meta: this.meta(query, data.length) };
  }

  async reconciliation(query: BillingReportQueryDto, actor: AuthenticatedUser) {
    this.assertCanView(actor);
    if (!hasBillingReportPermission(actor.role, 'billing.reconciliation.view')) {
      throw new ForbiddenException('You do not have permission to view reconciliation reports.');
    }
    const range = this.range(query);
    const where = this.paymentWhere(query, range);
    const payments = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: query.sortDirection },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        refunds: { select: { refundAmountCents: true, status: true, stripeRefundId: true } },
      },
    });
    const total = await this.prisma.payment.count({ where });
    await this.recordAudit(actor, 'BILLING_RECONCILIATION_VIEWED', 'reconciliation', {
      filters: this.auditFilters(query),
    });
    return {
      data: payments.map((payment) => {
        const completedRefunds = payment.refunds.filter(
          (refund) => refund.status === RefundStatus.SUCCEEDED,
        );
        const internalRefundCents = completedRefunds.reduce(
          (sum, refund) => sum + refund.refundAmountCents,
          0,
        );
        const stripeRefundCents = completedRefunds
          .filter((refund) => refund.stripeRefundId)
          .reduce((sum, refund) => sum + refund.refundAmountCents, 0);
        const result = !payment.providerPaymentId
          ? 'INTERNAL_ONLY'
          : completedRefunds.some((refund) => !refund.stripeRefundId)
            ? 'REFUND_MISMATCH'
            : 'MATCHED';
        return {
          paymentId: payment.id,
          stripePaymentIntentId: payment.providerPaymentId,
          internalPaymentAmountCents: payment.amountCents,
          stripePaymentAmountCents: payment.providerPaymentId ? payment.amountCents : null,
          internalRefundAmountCents: internalRefundCents,
          stripeRefundAmountCents: stripeRefundCents,
          internalStatus: payment.status,
          stripeStatus: payment.providerPaymentId ? 'WEBHOOK_SYNCHRONISED' : null,
          result,
        };
      }),
      meta: this.meta(query, total),
    };
  }

  async export(
    reportType: BillingReportType,
    query: BillingReportQueryDto,
    actor: AuthenticatedUser,
    format: 'csv' | 'pdf' | 'xlsx',
  ) {
    this.assertCanView(actor);
    if (!hasBillingReportPermission(actor.role, 'billing.reports.export')) {
      throw new ForbiddenException('You do not have permission to export billing reports.');
    }
    const exportQuery = { ...query, page: 1, pageSize: 10_000 };
    const report = await this.report(reportType, exportQuery, actor);
    const rows = this.rows(report);
    await this.recordAudit(actor, 'BILLING_REPORT_EXPORTED', reportType, {
      reportType,
      format,
      filters: this.auditFilters(query),
    });
    if (format === 'pdf')
      return {
        buffer: await this.pdf(reportType, rows),
        contentType: 'application/pdf',
        extension: 'pdf',
      };
    if (format === 'xlsx')
      return {
        buffer: this.xlsx(rows),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
      };
    return {
      buffer: Buffer.from(this.csv(rows), 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      extension: 'csv',
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

  private csv(rows: ReportRow[]): string {
    if (!rows.length) return '';
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const cell = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return [
      columns.map(cell).join(','),
      ...rows.map((row) => columns.map((column) => cell(row[column])).join(',')),
    ].join('\n');
  }

  private xlsx(rows: ReportRow[]): Buffer {
    const columns = rows.length
      ? [...new Set(rows.flatMap((row) => Object.keys(row)))]
      : ['No data'];
    const escape = (value: unknown) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const allRows = [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ''))];
    const sheet = allRows
      .map(
        (row, index) =>
          `<row r="${index + 1}">${row.map((value, column) => `<c r="${String.fromCharCode(65 + (column % 26))}${index + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`,
      )
      .join('');
    return this.zip({
      '[Content_Types].xml':
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
    });
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

  private async pdf(type: BillingReportType, rows: ReportRow[]): Promise<Buffer> {
    const document = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve) => document.on('end', resolve));
    document.fontSize(18).fillColor('#087f8c').text('MERO TELECOM');
    document.fontSize(14).fillColor('#111827').text(`Billing ${type} report`);
    document
      .fontSize(9)
      .fillColor('#4b5563')
      .text(`Generated ${new Date().toLocaleString('en-AU')} · AUD`);
    document.moveDown();
    for (const row of rows)
      document
        .fontSize(8)
        .fillColor('#111827')
        .text(
          Object.entries(row)
            .map(([key, value]) => `${key}: ${value ?? ''}`)
            .join('   '),
        );
    document.end();
    await done;
    return Buffer.concat(chunks);
  }

  private range(query: BillingReportQueryDto): ReportRange {
    const now = new Date();
    const from = query.from
      ? this.parseDate(query.from)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = query.to
      ? this.parseDate(query.to, true)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    if (to <= from) throw new BadRequestException('Report end date must be after the start date.');
    if (to.getTime() - from.getTime() > 366 * 86_400_000)
      throw new BadRequestException('Report ranges cannot exceed 366 days.');
    return { from, to };
  }

  private parseDate(value: string, end = false): Date {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00.000Z`)
      : new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid report date.');
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCDate(date.getUTCDate() + 1);
    return date;
  }

  private invoiceWhere(query: BillingReportQueryDto, range: ReportRange): Prisma.InvoiceWhereInput {
    const and: Prisma.InvoiceWhereInput[] = [{ issueDate: { gte: range.from, lt: range.to } }];
    if (query.customerId) and.push({ customerId: query.customerId });
    if (query.invoiceStatus) and.push({ status: query.invoiceStatus });
    if (query.planId)
      and.push({
        OR: [{ purchasePlanId: query.planId }, { subscription: { planId: query.planId } }],
      });
    if (query.subscriptionStatus) and.push({ subscription: { status: query.subscriptionStatus } });
    if (query.billingCycle) and.push({ subscription: { billingCycle: query.billingCycle } });
    if (query.search)
      and.push({
        OR: [
          { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
          { customer: { firstName: { contains: query.search, mode: 'insensitive' } } },
          { customer: { lastName: { contains: query.search, mode: 'insensitive' } } },
          { customer: { email: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    return { AND: and };
  }

  private paymentWhere(
    query: BillingReportQueryDto,
    range: ReportRange,
    extra: Prisma.PaymentWhereInput = {},
  ): Prisma.PaymentWhereInput {
    const and: Prisma.PaymentWhereInput[] = [
      { createdAt: { gte: range.from, lt: range.to } },
      extra,
    ];
    if (query.customerId) and.push({ customerId: query.customerId });
    if (query.paymentStatus) and.push({ status: query.paymentStatus });
    if (query.search)
      and.push({
        OR: [
          { providerPaymentId: { contains: query.search, mode: 'insensitive' } },
          { invoice: { invoiceNumber: { contains: query.search, mode: 'insensitive' } } },
          { customer: { email: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    return { AND: and };
  }

  private refundWhere(
    query: BillingReportQueryDto,
    range: ReportRange,
    status?: RefundStatus,
  ): Prisma.RefundWhereInput {
    const and: Prisma.RefundWhereInput[] = [{ requestedAt: { gte: range.from, lt: range.to } }];
    if (query.customerId) and.push({ customerId: query.customerId });
    if (query.refundStatus) and.push({ status: query.refundStatus });
    if (status) and.push({ status });
    if (query.search)
      and.push({
        OR: [
          { stripeRefundId: { contains: query.search, mode: 'insensitive' } },
          { customer: { email: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    return { AND: and };
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
      .filter((payment) => settledPaymentStatuses.includes(payment.status))
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

  private defaultGroupBy(range: ReportRange): RevenueGroupBy {
    const days = (range.to.getTime() - range.from.getTime()) / 86_400_000;
    return days <= 31
      ? RevenueGroupBy.DAY
      : days <= 120
        ? RevenueGroupBy.WEEK
        : RevenueGroupBy.MONTH;
  }

  private bucket(date: Date, groupBy: RevenueGroupBy): string {
    if (groupBy === RevenueGroupBy.MONTH) return date.toISOString().slice(0, 7);
    if (groupBy === RevenueGroupBy.WEEK) {
      const copy = new Date(date);
      const day = copy.getUTCDay() || 7;
      copy.setUTCDate(copy.getUTCDate() - day + 1);
      return copy.toISOString().slice(0, 10);
    }
    return date.toISOString().slice(0, 10);
  }
}
