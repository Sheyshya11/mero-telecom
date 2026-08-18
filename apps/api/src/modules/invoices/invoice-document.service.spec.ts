import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration';
import type { PrismaService } from '../../database/prisma.service';
import { InvoiceDocumentService, type StoredInvoicePdfData } from './invoice-document.service';
import type { InvoicePdfService } from './invoice-pdf.service';

const invoice = {
  id: '75ec8517-436c-4a93-9e8d-3850d35824fd',
  customerId: '952802e1-e97e-4c77-9a0a-5eaf0044334c',
  invoiceNumber: 'INV-2026-000001',
} as StoredInvoicePdfData;

describe('InvoiceDocumentService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('renders directly when object storage is not configured', async () => {
    const pdf = Buffer.from('%PDF-disabled');
    const service = new InvoiceDocumentService(
      configWith({ enabled: false }),
      {} as PrismaService,
      { render: jest.fn().mockResolvedValue(pdf) } as unknown as InvoicePdfService,
    );

    await expect(service.getOrCreate(invoice)).resolves.toBe(pdf);
  });

  it('uploads a private PDF and records its storage metadata', async () => {
    const pdf = Buffer.from('%PDF-stored');
    const send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const prisma = {
      invoiceDocument: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new InvoiceDocumentService(
      configWith({ enabled: true }),
      prisma as unknown as PrismaService,
      { render: jest.fn().mockResolvedValue(pdf) } as unknown as InvoicePdfService,
    );

    await expect(service.getOrCreate(invoice)).resolves.toBe(pdf);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect(prisma.invoiceDocument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          invoiceId: invoice.id,
          mimeType: 'application/pdf',
          sizeBytes: pdf.length,
        }),
      }),
    );
    service.onModuleDestroy();
  });
});

function configWith(overrides: { enabled: boolean }) {
  const storage: AppConfig['storage'] = {
    enabled: overrides.enabled,
    endpoint: 'https://s3.example.com',
    region: 'ap-southeast-2',
    bucket: 'mero-telecom-invoices',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-access-key',
    forcePathStyle: true,
  };
  return { getOrThrow: jest.fn().mockReturnValue(storage) } as unknown as ConfigService<
    AppConfig,
    true
  >;
}
