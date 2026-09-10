import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import { loadMeroTelecomLogo } from '../../../common/branding/mero-telecom-brand';
import type {
  BillingReportExportDocument,
  BillingReportExportMetadata,
  ReportRow,
} from '../billing-report-export.types';
import { BillingReportType } from '../dto/billing-report-query.dto';

const COLOURS = {
  ink: '#173044',
  muted: '#657786',
  line: '#D9E2E8',
  paper: '#FFFFFF',
  soft: '#F4F7F9',
  brand: '#087F8C',
  brandDark: '#075A67',
  brandPale: '#E7F4F5',
  positive: '#2F6D5A',
  caution: '#8A6217',
  danger: '#9A3D3D',
};

type PdfValueKind = 'date' | 'datetime' | 'money' | 'number' | 'percentage' | 'status' | 'text';

interface PdfColumn {
  heading: string;
  key: string;
  width: number;
  kind?: PdfValueKind;
  align?: 'left' | 'right';
}

const DETAIL_COLUMNS: Record<BillingReportType, PdfColumn[]> = {
  [BillingReportType.REVENUE]: [
    { heading: 'Period', key: 'period', width: 140 },
    { heading: 'Gross billed', key: 'grossBilledCents', width: 145, kind: 'money', align: 'right' },
    {
      heading: 'Payments received',
      key: 'paymentsReceivedCents',
      width: 150,
      kind: 'money',
      align: 'right',
    },
    { heading: 'Refunds paid', key: 'refundsPaidCents', width: 135, kind: 'money', align: 'right' },
    {
      heading: 'Net cash collected',
      key: 'netCashCollectedCents',
      width: 150,
      kind: 'money',
      align: 'right',
    },
  ],
  [BillingReportType.INVOICES]: [
    { heading: 'Invoice', key: 'invoiceNumber', width: 76 },
    { heading: 'Customer', key: 'customer', width: 112 },
    { heading: 'Plan', key: 'plan', width: 88 },
    { heading: 'Issued', key: 'issueDate', width: 68, kind: 'date' },
    { heading: 'Due', key: 'dueDate', width: 68, kind: 'date' },
    { heading: 'Total', key: 'totalCents', width: 72, kind: 'money', align: 'right' },
    { heading: 'Paid', key: 'amountPaidCents', width: 72, kind: 'money', align: 'right' },
    { heading: 'Outstanding', key: 'amountDueCents', width: 82, kind: 'money', align: 'right' },
    { heading: 'Status', key: 'status', width: 72, kind: 'status' },
  ],
  [BillingReportType.PAYMENTS]: [
    { heading: 'Payment ID', key: 'paymentId', width: 82 },
    { heading: 'Invoice', key: 'invoiceNumber', width: 78 },
    { heading: 'Customer', key: 'customer', width: 112 },
    { heading: 'Amount', key: 'amountCents', width: 78, kind: 'money', align: 'right' },
    { heading: 'Method', key: 'paymentMethod', width: 62 },
    { heading: 'Status', key: 'status', width: 68, kind: 'status' },
    { heading: 'Payment date', key: 'paymentDate', width: 92, kind: 'datetime' },
    { heading: 'Refunded', key: 'refundedCents', width: 78, kind: 'money', align: 'right' },
    { heading: 'Provider reference', key: 'stripePaymentIntentId', width: 112 },
  ],
  [BillingReportType.RECEIVABLES]: [
    { heading: 'Invoice', key: 'invoiceNumber', width: 86 },
    { heading: 'Customer', key: 'customer', width: 140 },
    { heading: 'Customer no.', key: 'customerNumber', width: 88 },
    { heading: 'Due', key: 'dueDate', width: 72, kind: 'date' },
    { heading: 'Days overdue', key: 'daysOverdue', width: 72, kind: 'number', align: 'right' },
    { heading: 'Ageing', key: 'ageingBucket', width: 68 },
    { heading: 'Invoice total', key: 'totalCents', width: 88, kind: 'money', align: 'right' },
    {
      heading: 'Outstanding',
      key: 'outstandingAmountCents',
      width: 92,
      kind: 'money',
      align: 'right',
    },
    { heading: 'Status', key: 'status', width: 72, kind: 'status' },
  ],
  [BillingReportType.REFUNDS]: [
    { heading: 'Refund ID', key: 'refundId', width: 76 },
    { heading: 'Customer', key: 'customer', width: 110 },
    { heading: 'Invoice', key: 'invoiceNumber', width: 74 },
    { heading: 'Amount', key: 'refundAmountCents', width: 75, kind: 'money', align: 'right' },
    { heading: 'Reason', key: 'reason', width: 150 },
    { heading: 'Requested', key: 'requestedDate', width: 82, kind: 'date' },
    { heading: 'Approved by', key: 'approvedBy', width: 100 },
    { heading: 'Status', key: 'status', width: 76, kind: 'status' },
  ],
  [BillingReportType.SUBSCRIPTIONS]: [
    { heading: 'Internet plan', key: 'planName', width: 170 },
    {
      heading: 'Active services',
      key: 'activeServices',
      width: 92,
      kind: 'number',
      align: 'right',
    },
    {
      heading: 'Active share',
      key: 'percentageOfActiveServices',
      width: 88,
      kind: 'percentage',
      align: 'right',
    },
    { heading: 'MRR', key: 'mrrCents', width: 92, kind: 'money', align: 'right' },
    { heading: 'ARPU', key: 'arpuCents', width: 92, kind: 'money', align: 'right' },
    { heading: 'Gross billed', key: 'grossBilledCents', width: 100, kind: 'money', align: 'right' },
    { heading: 'Collected', key: 'collectedCents', width: 96, kind: 'money', align: 'right' },
  ],
  [BillingReportType.RECONCILIATION]: [
    { heading: 'Payment ID', key: 'paymentId', width: 85 },
    { heading: 'Invoice', key: 'invoiceNumber', width: 82 },
    { heading: 'Provider reference', key: 'stripePaymentIntentId', width: 110 },
    {
      heading: 'Payment',
      key: 'internalPaymentAmountCents',
      width: 82,
      kind: 'money',
      align: 'right',
    },
    {
      heading: 'Refund',
      key: 'internalRefundAmountCents',
      width: 75,
      kind: 'money',
      align: 'right',
    },
    { heading: 'Payment status', key: 'internalStatus', width: 78, kind: 'status' },
    { heading: 'Invoice status', key: 'invoiceStatus', width: 78, kind: 'status' },
    { heading: 'Result', key: 'result', width: 82, kind: 'status' },
    { heading: 'Issues', key: 'issues', width: 110 },
  ],
};

@Injectable()
export class BillingReportPdfService {
  private readonly brandLogo = loadMeroTelecomLogo();

  async render(input: BillingReportExportDocument): Promise<Buffer> {
    const document = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      compress: true,
      info: {
        Title: input.metadata.reportName,
        Author: input.metadata.organisation,
        Subject: `${input.metadata.fromLocalDate} to ${input.metadata.toLocalDate}`,
        Keywords: 'Mero Telecom, billing, revenue, financial report, confidential',
      },
    });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    const complete = new Promise<void>((resolve, reject) => {
      document.on('end', resolve);
      document.on('error', reject);
    });

    document.addPage({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 36, right: 40, bottom: 0, left: 40 },
    });
    this.renderFirstPage(document, input);
    document.addPage({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 36, right: 40, bottom: 0, left: 40 },
    });
    this.renderAnalysisPage(document, input);
    this.renderDetails(document, input);
    const pageCountBeforeFooters = document.bufferedPageRange().count;
    this.renderFooters(document, input.metadata);
    if (document.bufferedPageRange().count !== pageCountBeforeFooters) {
      throw new Error('Billing report footer rendering unexpectedly changed the page count.');
    }

    document.end();
    await complete;
    return Buffer.concat(chunks);
  }

  private renderFirstPage(document: PDFKit.PDFDocument, input: BillingReportExportDocument): void {
    const { metadata } = input;
    document.save().rect(0, 0, document.page.width, 112).fill(COLOURS.ink).restore();
    document.image(this.brandLogo, 40, 30, { fit: [220, 42], valign: 'center' });
    document
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#B7CDD5')
      .text('BILLING & REVENUE', 390, 32, { width: 165, align: 'right', characterSpacing: 0.8 });
    document
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(COLOURS.paper)
      .text(metadata.reportName, 280, 50, { width: 275, align: 'right' });

    document
      .font('Helvetica-Bold')
      .fontSize(19)
      .fillColor(COLOURS.ink)
      .text(metadata.reportName, 40, 136);
    document.font('Helvetica').fontSize(8.2).fillColor(COLOURS.muted);
    this.metadataLine(
      document,
      'REPORTING PERIOD',
      `${this.reportDate(metadata.fromLocalDate)} - ${this.reportDate(metadata.toLocalDate)}`,
      40,
      171,
      245,
    );
    this.metadataLine(
      document,
      'GENERATED',
      this.reportDateTime(metadata.generatedAt, metadata.timezone),
      310,
      171,
      245,
    );
    this.metadataLine(document, 'REPORT ID', metadata.reportId, 40, 202, 245);
    this.metadataLine(document, 'GENERATED BY', metadata.generatedBy, 310, 202, 245);

    this.sectionHeading(document, 'Executive Summary', 40, 245);
    const metrics = this.record(this.record(input.overview).metrics);
    const cards = [
      ['GROSS BILLED', this.money(this.metricNumber(metrics.grossBilled, 'valueCents'))],
      ['PAYMENTS RECEIVED', this.money(this.metricNumber(metrics.paymentsReceived, 'valueCents'))],
      ['OUTSTANDING', this.money(this.metricNumber(metrics.outstanding, 'valueCents'))],
      ['NET CASH COLLECTED', this.money(this.metricNumber(metrics.netCashCollected, 'valueCents'))],
      ['OVERDUE BALANCE', this.money(this.metricNumber(metrics.overdueBalance, 'valueCents'))],
      ['REFUNDS PAID', this.money(this.metricNumber(metrics.refundsPaid, 'valueCents'))],
    ] as const;
    this.kpiCards(document, cards, 40, 278);

    this.sectionHeading(document, 'Revenue Trend', 40, 432);
    this.revenueChart(document, this.rowsFrom(input.revenue, 'trend'), 40, 465, 515, 150);

    this.sectionHeading(document, 'Financial Summary', 40, 645);
    this.summaryTable(document, input.overview, 40, 678, 515);
  }

  private renderAnalysisPage(
    document: PDFKit.PDFDocument,
    input: BillingReportExportDocument,
  ): void {
    this.compactPageHeader(document, 'Performance Analysis', input.metadata);
    this.sectionHeading(document, 'Revenue by Internet Plan', 40, 78);
    const plans = this.rowsFrom(input.plans, 'data');
    this.planChart(document, plans, 40, 111, 515, 190);
    this.planTable(document, plans, 40, 324, 515);

    this.sectionHeading(document, 'Payment Status Analysis', 40, 558);
    this.paymentHealth(document, input.overview, 40, 592, 515);

    document
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(COLOURS.muted)
      .text(
        'All values are presented from the existing filtered Mero Telecom reporting dataset. Currency is AUD.',
        40,
        748,
        { width: 515 },
      );
  }

  private renderDetails(document: PDFKit.PDFDocument, input: BillingReportExportDocument): void {
    const columns = DETAIL_COLUMNS[input.metadata.reportType];
    const rows = input.rows;
    let y = this.addDetailPage(document, input.metadata, columns);
    if (rows.length === 0) {
      document
        .save()
        .roundedRect(30, y + 20, 782, 82, 7)
        .fill(COLOURS.soft)
        .restore();
      document
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(COLOURS.ink)
        .text('No billing records found', 48, y + 43);
      document
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLOURS.muted)
        .text(
          `No records matched the selected reporting period and filters (${this.reportDate(input.metadata.fromLocalDate)} - ${this.reportDate(input.metadata.toLocalDate)}).`,
          48,
          y + 61,
          { width: 700 },
        );
      return;
    }

    rows.forEach((row, index) => {
      const pageCountBeforeRow = document.bufferedPageRange().count;
      const height = this.detailRowHeight(row, columns, input.metadata.timezone);
      let addedPage = false;
      if (y + height > 542) {
        y = this.addDetailPage(document, input.metadata, columns);
        addedPage = true;
      }
      if (index % 2 === 1) document.save().rect(30, y, 782, height).fill(COLOURS.soft).restore();
      let x = 30;
      for (const column of columns) {
        const value = this.formatValue(row[column.key], column.kind, input.metadata.timezone);
        document
          .font(column.kind === 'status' ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(7.2)
          .fillColor(column.kind === 'status' ? this.statusColour(value) : COLOURS.ink)
          .text(value, x + 5, y + 7, {
            width: column.width - 10,
            height: height - 10,
            align: column.align ?? 'left',
            ellipsis: true,
            lineGap: 1,
          });
        x += column.width;
      }
      document
        .save()
        .moveTo(30, y + height)
        .lineTo(812, y + height)
        .lineWidth(0.35)
        .stroke(COLOURS.line)
        .restore();
      if (document.bufferedPageRange().count !== pageCountBeforeRow + (addedPage ? 1 : 0)) {
        throw new Error('A detailed report row overflowed its allocated page area.');
      }
      y += height;
    });
  }

  private addDetailPage(
    document: PDFKit.PDFDocument,
    metadata: BillingReportExportMetadata,
    columns: PdfColumn[],
  ): number {
    const pageCountBefore = document.bufferedPageRange().count;
    document.addPage({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 28, right: 30, bottom: 0, left: 30 },
    });
    if (document.bufferedPageRange().count !== pageCountBefore + 1) {
      throw new Error('Detailed report page creation produced an unexpected page count.');
    }
    this.compactPageHeader(document, 'Detailed Records', metadata, true);
    if (document.bufferedPageRange().count !== pageCountBefore + 1) {
      throw new Error('Detailed report header overflowed onto another page.');
    }
    document
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(COLOURS.muted)
      .text(
        `${metadata.reportName}  |  ${this.reportDate(metadata.fromLocalDate)} - ${this.reportDate(metadata.toLocalDate)}  |  AUD`,
        30,
        66,
        { width: 782 },
      );
    if (document.bufferedPageRange().count !== pageCountBefore + 1) {
      throw new Error('Detailed report metadata overflowed onto another page.');
    }
    const y = 88;
    document.save().rect(30, y, 782, 29).fill(COLOURS.ink).restore();
    let x = 30;
    for (const column of columns) {
      document
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(COLOURS.paper)
        .text(column.heading.toUpperCase(), x + 5, y + 9, {
          width: column.width - 10,
          align: column.align ?? 'left',
          ellipsis: true,
        });
      x += column.width;
    }
    if (document.bufferedPageRange().count !== pageCountBefore + 1) {
      throw new Error('Detailed report table header overflowed onto another page.');
    }
    return y + 29;
  }

  private renderFooters(document: PDFKit.PDFDocument, metadata: BillingReportExportMetadata): void {
    const range = document.bufferedPageRange();
    for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
      document.switchToPage(pageIndex);
      const width = document.page.width;
      const y = document.page.height - 27;
      const originalBottomMargin = document.page.margins.bottom;
      document.page.margins.bottom = 0;
      document
        .save()
        .moveTo(document.page.margins.left, y - 8)
        .lineTo(width - document.page.margins.right, y - 8)
        .lineWidth(0.5)
        .stroke(COLOURS.line)
        .restore();
      document
        .font('Helvetica')
        .fontSize(7.2)
        .fillColor(COLOURS.muted)
        .text(
          `${metadata.organisation}  |  ${metadata.reportName}  |  Confidential`,
          document.page.margins.left,
          y,
          { width: width * 0.68 },
        );
      document
        .font('Helvetica-Bold')
        .fontSize(7.2)
        .fillColor(COLOURS.ink)
        .text(
          `Page ${pageIndex - range.start + 1} of ${range.count}`,
          width - document.page.margins.right - 100,
          y,
          { width: 100, align: 'right' },
        );
      document.page.margins.bottom = originalBottomMargin;
    }
  }

  private compactPageHeader(
    document: PDFKit.PDFDocument,
    title: string,
    metadata: BillingReportExportMetadata,
    landscape = false,
  ): void {
    const right = landscape ? 812 : 555;
    document.image(this.brandLogo, 40, 34, { fit: [155, 28], valign: 'center' });
    document
      .font('Helvetica')
      .fontSize(7.2)
      .fillColor(COLOURS.muted)
      .text(metadata.reportId, 40, 65);
    document
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(COLOURS.ink)
      .text(title, right - 230, 42, { width: 230, align: 'right' });
  }

  private metadataLine(
    document: PDFKit.PDFDocument,
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
  ): void {
    document
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(COLOURS.brand)
      .text(label, x, y, { width, characterSpacing: 0.7 });
    document
      .font('Helvetica')
      .fontSize(8.7)
      .fillColor(COLOURS.ink)
      .text(value, x, y + 11, { width, ellipsis: true });
  }

  private sectionHeading(document: PDFKit.PDFDocument, title: string, x: number, y: number): void {
    document
      .save()
      .rect(x, y + 2, 3, 15)
      .fill(COLOURS.brand)
      .restore();
    document
      .font('Helvetica-Bold')
      .fontSize(12.5)
      .fillColor(COLOURS.ink)
      .text(title, x + 12, y);
  }

  private kpiCards(
    document: PDFKit.PDFDocument,
    cards: ReadonlyArray<readonly [string, string]>,
    x: number,
    y: number,
  ): void {
    const width = 165;
    const gap = 10;
    const height = 60;
    cards.forEach(([label, value], index) => {
      const cardX = x + (index % 3) * (width + gap);
      const cardY = y + Math.floor(index / 3) * (height + 10);
      document
        .save()
        .roundedRect(cardX, cardY, width, height, 6)
        .fillAndStroke(index === 0 ? COLOURS.brandPale : COLOURS.soft, COLOURS.line)
        .restore();
      document
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(COLOURS.muted)
        .text(label, cardX + 12, cardY + 12, { width: width - 24, characterSpacing: 0.4 });
      document
        .font('Helvetica-Bold')
        .fontSize(14)
        .fillColor(index === 0 ? COLOURS.brandDark : COLOURS.ink)
        .text(value, cardX + 12, cardY + 29, { width: width - 24, ellipsis: true });
    });
  }

  private revenueChart(
    document: PDFKit.PDFDocument,
    rows: ReportRow[],
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    this.chartFrame(document, x, y, width, height);
    if (rows.length === 0) {
      this.noChartData(
        document,
        'No revenue trend data is available for this selection.',
        x,
        y,
        width,
        height,
      );
      return;
    }
    const values = rows.flatMap((row) => [
      this.number(row.grossBilledCents),
      this.number(row.netCashCollectedCents),
    ]);
    const max = Math.max(1, ...values);
    const plotX = x + 48;
    const plotY = y + 20;
    const plotWidth = width - 68;
    const plotHeight = height - 52;
    for (let line = 0; line <= 4; line += 1) {
      const lineY = plotY + (plotHeight * line) / 4;
      document
        .save()
        .moveTo(plotX, lineY)
        .lineTo(plotX + plotWidth, lineY)
        .lineWidth(0.35)
        .stroke(COLOURS.line)
        .restore();
      document
        .font('Helvetica')
        .fontSize(6.4)
        .fillColor(COLOURS.muted)
        .text(this.compactMoney(max * (1 - line / 4)), x + 3, lineY - 3, {
          width: 40,
          align: 'right',
        });
    }
    const pointX = (index: number) =>
      plotX + (rows.length === 1 ? plotWidth / 2 : (plotWidth * index) / (rows.length - 1));
    const drawSeries = (key: string, colour: string) => {
      document.save().lineWidth(1.7).strokeColor(colour);
      rows.forEach((row, index) => {
        const px = pointX(index);
        const py = plotY + plotHeight - (this.number(row[key]) / max) * plotHeight;
        if (index === 0) document.moveTo(px, py);
        else document.lineTo(px, py);
      });
      document.stroke().restore();
    };
    drawSeries('grossBilledCents', COLOURS.brand);
    drawSeries('netCashCollectedCents', COLOURS.positive);
    const labelStep = Math.max(1, Math.ceil(rows.length / 6));
    rows.forEach((row, index) => {
      if (index % labelStep !== 0 && index !== rows.length - 1) return;
      document
        .font('Helvetica')
        .fontSize(6.2)
        .fillColor(COLOURS.muted)
        .text(String(row.period ?? ''), pointX(index) - 24, plotY + plotHeight + 8, {
          width: 48,
          align: 'center',
          ellipsis: true,
        });
    });
    this.legend(
      document,
      [
        ['Gross billed', COLOURS.brand],
        ['Net cash collected', COLOURS.positive],
      ],
      x + width - 220,
      y + 5,
    );
  }

  private planChart(
    document: PDFKit.PDFDocument,
    rows: ReportRow[],
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    this.chartFrame(document, x, y, width, height);
    const plans = [...rows]
      .sort(
        (left, right) => this.number(right.grossBilledCents) - this.number(left.grossBilledCents),
      )
      .slice(0, 6);
    if (plans.length === 0) {
      this.noChartData(
        document,
        'No internet plan revenue data is available for this selection.',
        x,
        y,
        width,
        height,
      );
      return;
    }
    const max = Math.max(1, ...plans.map((row) => this.number(row.grossBilledCents)));
    const labelWidth = 135;
    const valueWidth = 82;
    const barX = x + labelWidth;
    const barWidth = width - labelWidth - valueWidth - 18;
    plans.forEach((row, index) => {
      const rowY = y + 22 + index * 26;
      document
        .font('Helvetica')
        .fontSize(7.4)
        .fillColor(COLOURS.ink)
        .text(String(row.planName ?? 'Unspecified plan'), x + 10, rowY + 3, {
          width: labelWidth - 18,
          ellipsis: true,
        });
      document.save().roundedRect(barX, rowY, barWidth, 14, 3).fill(COLOURS.soft).restore();
      const fillWidth = Math.max(2, (this.number(row.grossBilledCents) / max) * barWidth);
      document.save().roundedRect(barX, rowY, fillWidth, 14, 3).fill(COLOURS.brand).restore();
      document
        .font('Helvetica-Bold')
        .fontSize(7.4)
        .fillColor(COLOURS.ink)
        .text(this.money(this.number(row.grossBilledCents)), barX + barWidth + 8, rowY + 3, {
          width: valueWidth,
          align: 'right',
        });
    });
  }

  private planTable(
    document: PDFKit.PDFDocument,
    rows: ReportRow[],
    x: number,
    y: number,
    width: number,
  ): void {
    const visible = [...rows]
      .sort(
        (left, right) => this.number(right.grossBilledCents) - this.number(left.grossBilledCents),
      )
      .slice(0, 6);
    const columns = [230, 90, 98, 97];
    const headers = ['PLAN', 'ACTIVE SERVICES', 'GROSS BILLED', 'COLLECTED'];
    document.save().rect(x, y, width, 25).fill(COLOURS.ink).restore();
    let cursor = x;
    headers.forEach((header, index) => {
      document
        .font('Helvetica-Bold')
        .fontSize(6.8)
        .fillColor(COLOURS.paper)
        .text(header, cursor + 7, y + 8, {
          width: columns[index] - 14,
          align: index === 0 ? 'left' : 'right',
        });
      cursor += columns[index];
    });
    if (visible.length === 0) {
      document
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLOURS.muted)
        .text('No plan records found.', x + 8, y + 38);
      return;
    }
    visible.forEach((row, rowIndex) => {
      const rowY = y + 25 + rowIndex * 27;
      if (rowIndex % 2 === 1) document.save().rect(x, rowY, width, 27).fill(COLOURS.soft).restore();
      const values = [
        String(row.planName ?? 'Unspecified plan'),
        this.integer(row.activeServices),
        this.money(this.number(row.grossBilledCents)),
        this.money(this.number(row.collectedCents)),
      ];
      let cellX = x;
      values.forEach((value, index) => {
        document
          .font(index === 0 ? 'Helvetica' : 'Helvetica-Bold')
          .fontSize(7.5)
          .fillColor(COLOURS.ink)
          .text(value, cellX + 7, rowY + 9, {
            width: columns[index] - 14,
            align: index === 0 ? 'left' : 'right',
            ellipsis: true,
          });
        cellX += columns[index];
      });
      document
        .save()
        .moveTo(x, rowY + 27)
        .lineTo(x + width, rowY + 27)
        .lineWidth(0.35)
        .stroke(COLOURS.line)
        .restore();
    });
  }

  private summaryTable(
    document: PDFKit.PDFDocument,
    overviewValue: unknown,
    x: number,
    y: number,
    width: number,
  ): void {
    const overview = this.record(overviewValue);
    const metrics = this.record(overview.metrics);
    const rows = [
      [
        'Gross billed',
        this.money(this.metricNumber(metrics.grossBilled, 'valueCents')),
        'Issued invoice value in period',
      ],
      [
        'Payments received',
        this.money(this.metricNumber(metrics.paymentsReceived, 'valueCents')),
        'Settled payments in period',
      ],
      [
        'Outstanding',
        this.money(this.metricNumber(metrics.outstanding, 'valueCents')),
        'Balance as at report end',
      ],
      [
        'Net cash collected',
        this.money(this.metricNumber(metrics.netCashCollected, 'valueCents')),
        'Payments less completed refunds',
      ],
    ];
    const widths = [165, 130, 220];
    document.save().rect(x, y, width, 24).fill(COLOURS.ink).restore();
    ['METRIC', 'VALUE (AUD)', 'REPORTING BASIS'].forEach((header, index) => {
      const cellX = x + widths.slice(0, index).reduce((sum, value) => sum + value, 0);
      document
        .font('Helvetica-Bold')
        .fontSize(6.8)
        .fillColor(COLOURS.paper)
        .text(header, cellX + 7, y + 8, {
          width: widths[index] - 14,
          align: index === 1 ? 'right' : 'left',
        });
    });
    rows.forEach((row, rowIndex) => {
      const rowY = y + 24 + rowIndex * 24;
      if (rowIndex % 2 === 1) document.save().rect(x, rowY, width, 24).fill(COLOURS.soft).restore();
      row.forEach((value, columnIndex) => {
        const cellX = x + widths.slice(0, columnIndex).reduce((sum, item) => sum + item, 0);
        document
          .font(columnIndex === 1 ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(7.4)
          .fillColor(COLOURS.ink)
          .text(value, cellX + 7, rowY + 8, {
            width: widths[columnIndex] - 14,
            align: columnIndex === 1 ? 'right' : 'left',
            ellipsis: true,
          });
      });
    });
  }

  private paymentHealth(
    document: PDFKit.PDFDocument,
    overviewValue: unknown,
    x: number,
    y: number,
    width: number,
  ): void {
    const paymentHealth = this.record(this.record(overviewValue).paymentHealth);
    const items = [
      ['SUCCESSFUL PAYMENTS', this.integer(paymentHealth.successfulPaymentCount), COLOURS.positive],
      ['FAILED PAYMENTS', this.integer(paymentHealth.failedPaymentCount), COLOURS.danger],
      ['PAYMENT SUCCESS RATE', this.percent(paymentHealth.paymentSuccessRate), COLOURS.brand],
      [
        'AVERAGE PAYMENT',
        this.money(this.number(paymentHealth.averagePaymentValueCents)),
        COLOURS.ink,
      ],
      ['COMPLETED REFUNDS', this.integer(paymentHealth.refundCount), COLOURS.caution],
    ] as const;
    const cardWidth = (width - 32) / 5;
    items.forEach(([label, value, colour], index) => {
      const cardX = x + index * (cardWidth + 8);
      document
        .save()
        .roundedRect(cardX, y, cardWidth, 75, 5)
        .fillAndStroke(COLOURS.soft, COLOURS.line)
        .restore();
      document.save().rect(cardX, y, 3, 75).fill(colour).restore();
      document
        .font('Helvetica-Bold')
        .fontSize(6.3)
        .fillColor(COLOURS.muted)
        .text(label, cardX + 10, y + 13, { width: cardWidth - 18, height: 18 });
      document
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(colour)
        .text(value, cardX + 10, y + 46, { width: cardWidth - 18, ellipsis: true });
    });
  }

  private detailRowHeight(row: ReportRow, columns: PdfColumn[], timezone: string): number {
    let height = 28;
    columns.forEach((column) => {
      const text = this.formatValue(row[column.key], column.kind, timezone);
      const charactersPerLine = Math.max(5, Math.floor((column.width - 10) / 3.7));
      const lineCount = text
        .split(/\r?\n/)
        .reduce(
          (total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)),
          0,
        );
      height = Math.max(height, Math.min(58, lineCount * 9 + 14));
    });
    return height;
  }

  private chartFrame(
    document: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    document
      .save()
      .roundedRect(x, y, width, height, 6)
      .fillAndStroke(COLOURS.paper, COLOURS.line)
      .restore();
  }

  private noChartData(
    document: PDFKit.PDFDocument,
    message: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    document
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLOURS.ink)
      .text('No data for this selection', x + 20, y + height / 2 - 16, {
        width: width - 40,
        align: 'center',
      });
    document
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(COLOURS.muted)
      .text(message, x + 20, y + height / 2 + 2, { width: width - 40, align: 'center' });
  }

  private legend(
    document: PDFKit.PDFDocument,
    entries: Array<[string, string]>,
    x: number,
    y: number,
  ): void {
    let cursor = x;
    entries.forEach(([label, colour]) => {
      document
        .save()
        .circle(cursor + 3, y + 4, 3)
        .fill(colour)
        .restore();
      document
        .font('Helvetica')
        .fontSize(6.7)
        .fillColor(COLOURS.muted)
        .text(label, cursor + 10, y, { width: 90 });
      cursor += 105;
    });
  }

  private rowsFrom(value: unknown, key: string): ReportRow[] {
    const rows = this.record(value)[key];
    return Array.isArray(rows)
      ? rows.filter((row): row is ReportRow => typeof row === 'object' && row !== null)
      : [];
  }

  private record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private metricNumber(value: unknown, key: 'valueCents' | 'count'): number {
    return this.number(this.record(value)[key]);
  }

  private number(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private integer(value: unknown): string {
    return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(this.number(value));
  }

  private money(cents: number): string {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 2,
    }).format(cents / 100);
  }

  private compactMoney(cents: number): string {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(cents / 100);
  }

  private percent(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '-';
  }

  private reportDate(value: unknown, timezone = 'UTC'): string {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value ?? '');
    return new Intl.DateTimeFormat('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: timezone,
    }).format(date);
  }

  private reportDateTime(value: unknown, timezone: string): string {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value ?? '');
    return new Intl.DateTimeFormat('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    }).format(date);
  }

  private formatValue(value: unknown, kind: PdfValueKind = 'text', timezone: string): string {
    if (value === null || value === undefined) return '-';
    if (kind === 'money') return this.money(this.number(value));
    if (kind === 'number') return this.integer(value);
    if (kind === 'percentage') return this.percent(value);
    if (kind === 'date') return this.reportDate(value, timezone);
    if (kind === 'datetime') return this.reportDateTime(value, timezone);
    const text = Array.isArray(value) ? value.map(String).join('; ') : String(value);
    return text.replace(/[\u2013\u2014]/g, '-').replace(/_/g, ' ');
  }

  private statusColour(status: string): string {
    const value = status.toUpperCase();
    if (/(PAID|SUCCEEDED|MATCHED|COMPLETED|ACTIVE)/.test(value)) return COLOURS.positive;
    if (/(FAILED|OVERDUE|MISMATCH|REJECTED|CANCELLED)/.test(value)) return COLOURS.danger;
    if (/(PENDING|REVIEW|MISSING|ISSUED)/.test(value)) return COLOURS.caution;
    return COLOURS.ink;
  }
}
