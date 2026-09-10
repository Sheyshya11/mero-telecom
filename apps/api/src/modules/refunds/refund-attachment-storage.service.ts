import { Injectable } from '@nestjs/common';

import { PrivateAttachmentStorageService } from '../../common/files/private-attachment-storage.service';

@Injectable()
export class RefundAttachmentStorageService {
  constructor(private readonly storage: PrivateAttachmentStorageService) {}

  async upload(
    refundId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ storageKey: string; size: number }> {
    return this.storage.upload('refunds', refundId, file);
  }

  remove(storageKey: string): Promise<void> {
    return this.storage.remove(storageKey);
  }

  getAccessUrl(storageKey: string, relativePath: string, expiresInSeconds = 300): Promise<string> {
    return this.storage.getAccessUrl(storageKey, relativePath, expiresInSeconds);
  }

  readLocal(storageKey: string): Promise<Buffer> {
    return this.storage.readLocal(storageKey);
  }

  verifyLocalSignature(storageKey: string, expires: number, signature: string): boolean {
    return this.storage.verifyLocalSignature(storageKey, expires, signature);
  }
}
