import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalRequestEventType, Prisma, Role } from '@prisma/client';

import { PrivateAttachmentStorageService } from '../../common/files/private-attachment-storage.service';
import { PrivateFileSecurityService } from '../../common/files/private-file-security.service';
import type { UploadedPrivateFile } from '../../common/files/private-file.types';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { hasAnyRole, type AuthenticatedUser } from '../auth/auth.types';

const attachmentSelect = {
  id: true,
  messageId: true,
  originalName: true,
  mimeType: true,
  fileSize: true,
  createdAt: true,
} satisfies Prisma.InternalRequestAttachmentSelect;

type AttachmentRecord = Prisma.InternalRequestAttachmentGetPayload<{
  select: typeof attachmentSelect;
}>;

@Injectable()
export class InternalRequestAttachmentsService {
  private readonly limits: AppConfig['supportAttachments'];

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
    private readonly security: PrivateFileSecurityService,
    private readonly storage: PrivateAttachmentStorageService,
  ) {
    this.limits = config.getOrThrow('supportAttachments');
  }

  validate(files: UploadedPrivateFile[] = []): Promise<void> {
    return this.security.assertValid(
      files,
      this.limits.maxFiles,
      this.limits.maxFileSizeBytes,
      this.limits.maxTotalSizeBytes,
    );
  }

  async createForMessage(
    transaction: Prisma.TransactionClient,
    internalRequestId: string,
    messageId: string,
    files: UploadedPrivateFile[] = [],
  ): Promise<AttachmentRecord[]> {
    if (!files.length) return [];
    const uploadedKeys: string[] = [];
    try {
      const records: AttachmentRecord[] = [];
      for (const file of files) {
        const stored = await this.storage.upload('internal-requests', internalRequestId, file);
        uploadedKeys.push(stored.storageKey);
        records.push(
          await transaction.internalRequestAttachment.create({
            data: {
              messageId,
              originalName: safeFilename(file.originalname),
              storageKey: stored.storageKey,
              mimeType: file.mimetype,
              fileSize: stored.size,
            },
            select: attachmentSelect,
          }),
        );
      }
      return records;
    } catch (error) {
      await Promise.all(uploadedKeys.map((storageKey) => this.storage.remove(storageKey)));
      throw error;
    }
  }

  async accessUrl(
    requestNumber: string,
    attachmentId: string,
    actor: AuthenticatedUser,
    relativePath: string,
  ) {
    const attachment = await this.authorizedAttachment(requestNumber, attachmentId, actor);
    return {
      url: await this.storage.getAccessUrl(attachment.storageKey, relativePath),
      expiresInSeconds: 300,
      attachment: this.publicView(attachment),
    };
  }

  async readLocal(requestNumber: string, attachmentId: string, expires: number, signature: string) {
    const attachment = await this.prisma.internalRequestAttachment.findFirst({
      where: { id: attachmentId, message: { internalRequest: { requestNumber } } },
      select: { ...attachmentSelect, storageKey: true },
    });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    if (!this.storage.verifyLocalSignature(attachment.storageKey, expires, signature)) {
      throw new ForbiddenException('This attachment link has expired or is invalid.');
    }
    return { attachment, buffer: await this.storage.readLocal(attachment.storageKey) };
  }

  private async authorizedAttachment(
    requestNumber: string,
    attachmentId: string,
    actor: AuthenticatedUser,
  ) {
    const internalRequestWhere: Prisma.InternalRequestWhereInput = hasAnyRole(actor, [
      Role.SUPER_ADMIN,
    ])
      ? {
          requestNumber,
          events: { some: { eventType: InternalRequestEventType.ESCALATED } },
        }
      : hasAnyRole(actor, [Role.ADMIN])
        ? { requestNumber, requesterRole: Role.STAFF }
        : { requestNumber, requestedByUserId: actor.id, requesterRole: Role.STAFF };
    const attachment = await this.prisma.internalRequestAttachment.findFirst({
      where: {
        id: attachmentId,
        message: { internalRequest: internalRequestWhere },
      },
      select: { ...attachmentSelect, storageKey: true },
    });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    return attachment;
  }

  private publicView(attachment: AttachmentRecord) {
    return {
      id: attachment.id,
      messageId: attachment.messageId,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      createdAt: attachment.createdAt,
    };
  }
}

function safeFilename(value: string): string {
  const unsafePunctuation = new Set(['"', '<', '>', ':', '|', '?', '*']);
  const name = Array.from(value.split(/[\\/]/).at(-1) ?? '')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127 && !unsafePunctuation.has(character);
    })
    .join('');
  return name.trim().slice(0, 255) || 'attachment';
}
