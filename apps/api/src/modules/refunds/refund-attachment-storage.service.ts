import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { AppConfig } from '../../config/configuration';

@Injectable()
export class RefundAttachmentStorageService implements OnModuleDestroy {
  private readonly logger = new Logger(RefundAttachmentStorageService.name);
  private readonly storage: AppConfig['storage'];
  private readonly client: S3Client | null;
  private readonly localRoot = resolve(process.cwd(), '.private', 'refund-attachments');
  private readonly signingSecret: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.storage = config.getOrThrow('storage');
    this.signingSecret = config.getOrThrow('jwt').accessSecret;
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

  async upload(
    refundId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ storageKey: string; size: number }> {
    const storageKey = `refunds/${refundId}/${randomUUID()}`;
    if (this.client) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.storage.bucket,
          Key: storageKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          CacheControl: 'private, no-store',
          Metadata: { refundId },
        }),
      );
    } else {
      const destination = join(this.localRoot, storageKey);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.buffer, { flag: 'wx' });
    }
    return { storageKey, size: file.buffer.length };
  }

  async remove(storageKey: string): Promise<void> {
    try {
      if (this.client) {
        await this.client.send(
          new DeleteObjectCommand({ Bucket: this.storage.bucket, Key: storageKey }),
        );
      } else {
        await unlink(join(this.localRoot, storageKey));
      }
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'refund_attachment_delete_failed',
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  async getAccessUrl(
    storageKey: string,
    relativePath: string,
    expiresInSeconds = 300,
  ): Promise<string> {
    if (this.client) {
      return getSignedUrl(
        this.client as never,
        new GetObjectCommand({ Bucket: this.storage.bucket, Key: storageKey }),
        { expiresIn: expiresInSeconds },
      );
    }
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = this.sign(storageKey, expires);
    return `${relativePath}?expires=${expires}&signature=${signature}`;
  }

  async readLocal(storageKey: string): Promise<Buffer> {
    if (this.client) throw new Error('S3 objects must be accessed with a signed URL.');
    return readFile(join(this.localRoot, storageKey));
  }

  verifyLocalSignature(storageKey: string, expires: number, signature: string): boolean {
    if (expires < Math.floor(Date.now() / 1000)) return false;
    const expected = this.sign(storageKey, expires);
    return (
      expected.length === signature.length &&
      createHmac('sha256', this.signingSecret).update(`${storageKey}:${expires}`).digest('hex') ===
        signature
    );
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  private sign(storageKey: string, expires: number): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${storageKey}:${expires}`)
      .digest('hex');
  }
}
