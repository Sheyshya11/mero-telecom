import { BadRequestException, Injectable } from '@nestjs/common';

import type { UploadedRefundFile, FileSecurityScanner } from './refund-attachment.types';

export const ALLOWED_REFUND_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

type AllowedMimeType = (typeof ALLOWED_REFUND_MIME_TYPES)[number];

@Injectable()
export class RefundFileSecurityService implements FileSecurityScanner {
  async scan(file: UploadedRefundFile) {
    const mimeType = detectMimeType(file.buffer);
    if (!mimeType || !ALLOWED_REFUND_MIME_TYPES.includes(mimeType)) {
      return { clean: false, reason: 'The file type could not be verified.' };
    }
    if (mimeType !== file.mimetype) {
      return { clean: false, reason: 'The file content does not match its declared type.' };
    }
    return { clean: true };
  }

  async assertValid(
    files: UploadedRefundFile[],
    maxFiles: number,
    maxFileSize: number,
    maxTotalSize: number,
  ) {
    if (files.length > maxFiles) {
      throw new BadRequestException(`You can upload a maximum of ${maxFiles} files.`);
    }
    const totalSize = files.reduce((total, file) => total + file.size, 0);
    if (totalSize > maxTotalSize) {
      throw new BadRequestException('Your attachments exceed the total size limit.');
    }
    for (const file of files) {
      if (file.size > maxFileSize) {
        throw new BadRequestException(`${file.originalname} exceeds the maximum file size.`);
      }
      const result = await this.scan(file);
      if (!result.clean) throw new BadRequestException(`${file.originalname}: ${result.reason}`);
    }
  }
}

function detectMimeType(buffer: Buffer): AllowedMimeType | null {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (
    buffer.length >= 8 &&
    buffer.readUInt32BE(0) === 0x89504e47 &&
    buffer.readUInt32BE(4) === 0x0d0a1a0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 4 &&
    buffer.readUInt32BE(0) === 0xd0cf11e0 &&
    (buffer.includes(Buffer.from('WordDocument')) ||
      buffer.includes(
        Buffer.from(
          'W\u0000o\u0000r\u0000d\u0000D\u0000o\u0000c\u0000u\u0000m\u0000e\u0000n\u0000t',
        ),
      ))
  ) {
    return 'application/msword';
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'PK\u0003\u0004') {
    const text = buffer.toString('latin1');
    if (text.includes('[Content_Types].xml') && text.includes('word/')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
  }
  return null;
}
