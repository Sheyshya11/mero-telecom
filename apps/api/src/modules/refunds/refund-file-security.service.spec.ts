import { BadRequestException } from '@nestjs/common';

import { RefundFileSecurityService } from './refund-file-security.service';

describe('RefundFileSecurityService', () => {
  const service = new RefundFileSecurityService();

  it.each([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['image/webp', Buffer.from('RIFF0000WEBP')],
    ['application/pdf', Buffer.from('%PDF-1.7')],
    ['application/msword', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, ...Buffer.from('WordDocument')])],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      Buffer.from('PK\u0003\u0004 [Content_Types].xml word/document.xml'),
    ],
  ])('accepts a verified %s file', async (mimetype, buffer) => {
    await expect(
      service.scan({ buffer, mimetype, originalname: 'evidence', size: buffer.length }),
    ).resolves.toEqual({ clean: true });
  });

  it('rejects extension spoofing and unsupported binary content', async () => {
    await expect(
      service.assertValid(
        [
          {
            buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            mimetype: 'application/pdf',
            originalname: 'receipt.pdf',
            size: 12,
          },
        ],
        5,
        10_000,
        20_000,
      ),
    ).rejects.toThrow('file content does not match');
  });

  it('enforces file count, per-file, and total-size limits', async () => {
    const files = Array.from({ length: 3 }, (_, index) => ({
      buffer: Buffer.from('%PDF-1.7'),
      mimetype: 'application/pdf',
      originalname: `file-${index}.pdf`,
      size: 6,
    }));
    await expect(service.assertValid(files, 2, 100, 100)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.assertValid([files[0]!], 5, 5, 100)).rejects.toThrow('maximum file size');
    await expect(service.assertValid(files, 5, 100, 10)).rejects.toThrow('total size');
  });
});
