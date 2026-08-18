import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { InvoicePdfService, type InvoicePdfData } from './invoice-pdf.service';

export type StoredInvoicePdfData = InvoicePdfData & {
  id: string;
  customerId: string;
};

@Injectable()
export class InvoiceDocumentService implements OnModuleDestroy {
  private readonly logger = new Logger(InvoiceDocumentService.name);
  private readonly storage: AppConfig['storage'];
  private readonly client: S3Client | null;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly invoicePdf: InvoicePdfService,
  ) {
    this.storage = config.getOrThrow('storage');
    this.client = this.storage.enabled
      ? new S3Client({
          endpoint: this.storage.endpoint || undefined,
          region: this.storage.region,
          forcePathStyle: this.storage.forcePathStyle,
          credentials: {
            accessKeyId: this.storage.accessKeyId,
            secretAccessKey: this.storage.secretAccessKey,
          },
        })
      : null;
  }

  async getOrCreate(invoice: StoredInvoicePdfData): Promise<Buffer> {
    if (!this.client) return this.invoicePdf.render(invoice);

    const existing = await this.prisma.invoiceDocument.findUnique({
      where: { invoiceId: invoice.id },
    });
    if (existing) {
      try {
        const response = await this.client.send(
          new GetObjectCommand({ Bucket: this.storage.bucket, Key: existing.storageKey }),
        );
        if (response.Body) return Buffer.from(await response.Body.transformToByteArray());
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'invoice_document_read_failed',
            invoiceId: invoice.id,
            error: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
      }
    }

    const pdf = await this.invoicePdf.render(invoice);
    const storageKey = `invoices/${invoice.customerId}/${invoice.invoiceNumber}.pdf`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.storage.bucket,
        Key: storageKey,
        Body: pdf,
        ContentType: 'application/pdf',
        CacheControl: 'private, no-store',
        Metadata: { invoiceId: invoice.id },
      }),
    );
    await this.prisma.invoiceDocument.upsert({
      where: { invoiceId: invoice.id },
      create: {
        invoiceId: invoice.id,
        storageKey,
        mimeType: 'application/pdf',
        sizeBytes: pdf.length,
      },
      update: { storageKey, mimeType: 'application/pdf', sizeBytes: pdf.length },
    });
    return pdf;
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }
}
