import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { AppConfig } from '../../config/configuration';

@Injectable()
export class PrivateAttachmentStorageService implements OnModuleDestroy {
  private readonly logger = new Logger(PrivateAttachmentStorageService.name);
  private readonly storage: AppConfig['storage'];
  private readonly client: S3Client | null;
  private readonly localRoot = resolve(process.cwd(), '.private');
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
    scope: 'refunds' | 'support' | 'internal-requests',
    ownerId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ storageKey: string; size: number }> {
    const storageKey = `${scope}/${ownerId}/${randomUUID()}`;
    if (this.client) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.storage.bucket,
          Key: storageKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          CacheControl: 'private, no-store',
          Metadata: { scope, ownerId },
        }),
      );
    } else {
      const destination = this.localPath(storageKey);
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
        await unlink(this.localPath(storageKey));
      }
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'private_attachment_delete_failed',
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
    return `${relativePath}?expires=${expires}&signature=${this.sign(storageKey, expires)}`;
  }

  async readLocal(storageKey: string): Promise<Buffer> {
    if (this.client) throw new Error('S3 objects must be accessed with a signed URL.');
    return readFile(this.localPath(storageKey));
  }

  verifyLocalSignature(storageKey: string, expires: number, signature: string): boolean {
    if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(this.sign(storageKey, expires), 'utf8');
    const supplied = Buffer.from(signature ?? '', 'utf8');
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  private sign(storageKey: string, expires: number): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${storageKey}:${expires}`)
      .digest('hex');
  }

  private localPath(storageKey: string): string {
    const namespace = storageKey.startsWith('refunds/')
      ? 'refund-attachments'
      : storageKey.startsWith('internal-requests/')
        ? 'internal-request-attachments'
        : 'support-attachments';
    return join(this.localRoot, namespace, storageKey);
  }
}
