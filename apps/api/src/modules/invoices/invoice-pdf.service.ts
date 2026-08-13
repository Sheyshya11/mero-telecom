import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface InvoicePdfData {
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  customer: {
    customerNumber: string;
    firstName: string;
    lastName: string;
    email: string;
    addressLine1: string;
    addressLine2: string | null;
    suburb: string;
    state: string;
    postcode: string;
  };
  subscription: { plan: { name: string } } | null;
  items: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
  }>;
}

@Injectable()
export class InvoicePdfService {
  render(invoice: InvoicePdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: { Title: invoice.invoiceNumber },
      });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);

      this.drawHeader(document, invoice);
      this.drawRecipient(document, invoice);
      this.drawItems(document, invoice);
      this.drawTotals(document, invoice);
      this.drawFooter(document);
      document.end();
    });
  }

  private drawHeader(document: PDFKit.PDFDocument, invoice: InvoicePdfData): void {
    document.rect(0, 0, document.page.width, 122).fill('#075985');
    document.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text('MERO TELECOM', 50, 42);
    document.font('Helvetica').fontSize(10).text('Integrated ISP Management Platform', 50, 74);
    document
      .font('Helvetica-Bold')
      .fontSize(21)
      .text('TAX INVOICE', 410, 43, { width: 135, align: 'right' });
    document
      .font('Helvetica')
      .fontSize(10)
      .text(invoice.invoiceNumber, 410, 75, { width: 135, align: 'right' });
    document.fillColor('#0f172a');
  }

  private drawRecipient(document: PDFKit.PDFDocument, invoice: InvoicePdfData): void {
    const issueDate = this.formatDate(invoice.issueDate);
    const dueDate = this.formatDate(invoice.dueDate);
    document.font('Helvetica-Bold').fontSize(10).fillColor('#475569').text('BILL TO', 50, 155);
    document
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#0f172a')
      .text(`${invoice.customer.firstName} ${invoice.customer.lastName}`, 50, 174);
    document
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#334155')
      .text(invoice.customer.customerNumber, 50, 193);
    document.text(invoice.customer.email, 50, 208);
    document.text(invoice.customer.addressLine1, 50, 223);
    if (invoice.customer.addressLine2) document.text(invoice.customer.addressLine2, 50, 238);
    document.text(
      `${invoice.customer.suburb} ${invoice.customer.state} ${invoice.customer.postcode}`,
      50,
      invoice.customer.addressLine2 ? 253 : 238,
    );

    document
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#475569')
      .text('INVOICE DETAILS', 365, 155);
    document.font('Helvetica').fontSize(10).fillColor('#334155');
    document.text(`Issue date: ${issueDate}`, 365, 174);
    document.text(`Due date: ${dueDate}`, 365, 192);
    document.text(`Service: ${invoice.subscription?.plan.name ?? 'Internet service'}`, 365, 210, {
      width: 180,
    });
    document.fillColor('#0f172a');
  }

  private drawItems(document: PDFKit.PDFDocument, invoice: InvoicePdfData): void {
    const top = 295;
    document.rect(50, top, 495, 28).fill('#e0f2fe');
    document.font('Helvetica-Bold').fontSize(9).fillColor('#0c4a6e');
    document.text('DESCRIPTION', 62, top + 10);
    document.text('QTY', 368, top + 10, { width: 36, align: 'right' });
    document.text('UNIT PRICE', 415, top + 10, { width: 62, align: 'right' });
    document.text('AMOUNT', 485, top + 10, { width: 48, align: 'right' });

    let y = top + 42;
    document.font('Helvetica').fontSize(10).fillColor('#1e293b');
    invoice.items.forEach((item) => {
      document.text(item.description, 62, y, { width: 285 });
      document.text(String(item.quantity), 368, y, { width: 36, align: 'right' });
      document.text(this.formatMoney(item.unitPriceCents, invoice.currency), 400, y, {
        width: 77,
        align: 'right',
      });
      document.text(this.formatMoney(item.amountCents, invoice.currency), 480, y, {
        width: 53,
        align: 'right',
      });
      y += Math.max(28, document.heightOfString(item.description, { width: 285 }) + 12);
      document
        .moveTo(50, y - 8)
        .lineTo(545, y - 8)
        .strokeColor('#e2e8f0')
        .stroke();
    });
  }

  private drawTotals(document: PDFKit.PDFDocument, invoice: InvoicePdfData): void {
    const top = 435;
    document.font('Helvetica').fontSize(10).fillColor('#475569');
    document.text('Subtotal (ex GST)', 365, top, { width: 105 });
    document.text(this.formatMoney(invoice.subtotalCents, invoice.currency), 475, top, {
      width: 58,
      align: 'right',
    });
    document.text('GST included', 365, top + 21, { width: 105 });
    document.text(this.formatMoney(invoice.taxCents, invoice.currency), 475, top + 21, {
      width: 58,
      align: 'right',
    });
    document.rect(355, top + 49, 190, 42).fill('#075985');
    document
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#ffffff')
      .text('TOTAL DUE', 367, top + 64);
    document
      .fontSize(15)
      .text(this.formatMoney(invoice.totalCents, invoice.currency), 455, top + 61, {
        width: 77,
        align: 'right',
      });
    document.fillColor('#0f172a');
  }

  private drawFooter(document: PDFKit.PDFDocument): void {
    document.moveTo(50, 700).lineTo(545, 700).strokeColor('#cbd5e1').stroke();
    document
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#64748b')
      .text('Thank you for choosing Mero Telecom.', 50, 715);
    document.text('This invoice was generated from Mero Telecom billing records.', 50, 730);
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }

  private formatMoney(cents: number, currency: string): string {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100);
  }
}
