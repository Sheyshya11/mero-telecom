import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RefundStatus, Role } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { UploadedRefundFile } from './refund-attachment.types';
import { RefundAttachmentStorageService } from './refund-attachment-storage.service';
import { RefundFileSecurityService } from './refund-file-security.service';

const attachmentSelect = {
  id: true,
  refundId: true,
  originalName: true,
  mimeType: true,
  fileSize: true,
  uploadedByRole: true,
  createdAt: true,
  uploadedBy: { select: { email: true, displayName: true } },
} satisfies Prisma.RefundAttachmentSelect;

type AttachmentRecord = Prisma.RefundAttachmentGetPayload<{ select: typeof attachmentSelect }>;

@Injectable()
export class RefundAttachmentsService {
  private readonly limits: AppConfig['refundAttachments'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly security: RefundFileSecurityService,
    private readonly storage: RefundAttachmentStorageService,
  ) {
    this.limits = config.getOrThrow('refundAttachments');
  }

  async validate(files: UploadedRefundFile[] = []): Promise<void> {
    await this.security.assertValid(
      files,
      this.limits.maxFiles,
      this.limits.maxFileSizeBytes,
      this.limits.maxTotalSizeBytes,
    );
  }

  async createForRefund(
    transaction: Prisma.TransactionClient,
    refundId: string,
    actor: AuthenticatedUser,
    files: UploadedRefundFile[] = [],
  ): Promise<AttachmentRecord[]> {
    await this.validate(files);
    if (!files.length) return [];
    const uploadedKeys: string[] = [];
    try {
      const records: AttachmentRecord[] = [];
      for (const file of files) {
        const stored = await this.storage.upload(refundId, {
          buffer: file.buffer,
          mimetype: file.mimetype,
        });
        uploadedKeys.push(stored.storageKey);
        const record = await transaction.refundAttachment.create({
          data: {
            refundId,
            originalName: file.originalname.slice(0, 255),
            storageKey: stored.storageKey,
            mimeType: file.mimetype,
            fileSize: stored.size,
            uploadedById: actor.id,
            uploadedByRole: actor.role,
          },
          select: attachmentSelect,
        });
        records.push(record);
      }
      await this.audit(transaction, 'REFUND_ATTACHMENT_UPLOADED', refundId, actor, {
        count: records.length,
        attachmentIds: records.map((record) => record.id),
        files: records.map((record) => ({
          name: record.originalName,
          mimeType: record.mimeType,
          size: record.fileSize,
        })),
      });
      return records;
    } catch (error) {
      await Promise.all(uploadedKeys.map((key) => this.storage.remove(key)));
      throw error;
    }
  }

  async add(
    refundId: string,
    files: UploadedRefundFile[],
    actor: AuthenticatedUser,
  ): Promise<AttachmentRecord[]> {
    await this.validate(files);
    if (!files.length) throw new BadRequestException('At least one attachment is required.');
    const refund = await this.authorizedRefund(refundId, actor);
    const existing = await this.prisma.refundAttachment.aggregate({
      where: { refundId, deletedAt: null },
      _count: { _all: true },
      _sum: { fileSize: true },
    });
    if (existing._count._all + files.length > this.limits.maxFiles) {
      throw new BadRequestException(
        `You can upload a maximum of ${this.limits.maxFiles} files per refund.`,
      );
    }
    if (
      (existing._sum.fileSize ?? 0) + files.reduce((total, file) => total + file.size, 0) >
      this.limits.maxTotalSizeBytes
    ) {
      throw new BadRequestException(
        'Your attachments exceed the total size limit for this refund.',
      );
    }
    if (actor.role === Role.CUSTOMER && refund.status !== RefundStatus.MORE_INFORMATION_REQUIRED) {
      throw new ConflictException(
        'Additional evidence can only be uploaded when requested by staff.',
      );
    }
    const closedStatuses: RefundStatus[] = [
      RefundStatus.APPROVED,
      RefundStatus.PROCESSING,
      RefundStatus.SUCCEEDED,
      RefundStatus.REJECTED,
      RefundStatus.CANCELLED,
    ];
    if (closedStatuses.includes(refund.status)) {
      throw new ConflictException('This refund request is closed to new evidence.');
    }
    const uploaded = await this.prisma.$transaction(async (transaction) => {
      const records = await this.createForRefund(transaction, refundId, actor, files);
      if (
        actor.role === Role.CUSTOMER &&
        refund.status === RefundStatus.MORE_INFORMATION_REQUIRED
      ) {
        await transaction.refund.update({
          where: { id: refundId },
          data: { status: RefundStatus.UNDER_REVIEW },
        });
        await this.audit(transaction, 'REFUND_ADDITIONAL_EVIDENCE_SUBMITTED', refundId, actor, {
          attachmentIds: records.map((record) => record.id),
          previousStatus: refund.status,
          newStatus: RefundStatus.UNDER_REVIEW,
        });
      }
      return records;
    });
    return uploaded;
  }

  async list(refundId: string, actor: AuthenticatedUser): Promise<AttachmentRecord[]> {
    await this.authorizedRefund(refundId, actor);
    return this.prisma.refundAttachment.findMany({
      where: { refundId, deletedAt: null },
      select: attachmentSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async accessUrl(
    refundId: string,
    attachmentId: string,
    actor: AuthenticatedUser,
    relativePath: string,
  ) {
    await this.authorizedRefund(refundId, actor);
    const attachment = await this.findAttachment(refundId, attachmentId);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'REFUND_ATTACHMENT_VIEWED',
        entityType: 'Refund',
        entityId: refundId,
        metadata: {
          attachmentId,
          filename: attachment.originalName,
          mimeType: attachment.mimeType,
          size: attachment.fileSize,
          actorRole: actor.role,
        },
      },
    });
    return {
      url: await this.storage.getAccessUrl(attachment.storageKey, relativePath),
      expiresInSeconds: 300,
      attachment: this.publicView(attachment),
    };
  }

  async readLocal(refundId: string, attachmentId: string, expires: number, signature: string) {
    const attachment = await this.findAttachment(refundId, attachmentId);
    if (!this.storage.verifyLocalSignature(attachment.storageKey, expires, signature)) {
      throw new ForbiddenException('This attachment link has expired or is invalid.');
    }
    return { attachment, buffer: await this.storage.readLocal(attachment.storageKey) };
  }

  async remove(refundId: string, attachmentId: string, actor: AuthenticatedUser): Promise<void> {
    const refund = await this.authorizedRefund(refundId, actor);
    if (actor.role !== Role.CUSTOMER)
      throw new ForbiddenException('Submitted evidence is auditable and cannot be removed here.');
    if (refund.status !== RefundStatus.DRAFT)
      throw new ConflictException('Submitted evidence cannot be removed.');
    const attachment = await this.findAttachment(refundId, attachmentId);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.refundAttachment.update({
        where: { id: attachmentId },
        data: { deletedAt: new Date() },
      });
      await this.audit(transaction, 'REFUND_ATTACHMENT_REMOVED', refundId, actor, {
        attachmentId,
        filename: attachment.originalName,
      });
    });
    await this.storage.remove(attachment.storageKey);
  }

  private async authorizedRefund(refundId: string, actor: AuthenticatedUser) {
    const refund = await this.prisma.refund.findFirst({
      where:
        actor.role === Role.CUSTOMER
          ? { id: refundId, customer: { userId: actor.id } }
          : { id: refundId },
      select: { id: true, status: true },
    });
    if (!refund) throw new NotFoundException('Refund not found.');
    return refund;
  }

  private async findAttachment(
    refundId: string,
    attachmentId: string,
  ): Promise<AttachmentRecord & { storageKey: string }> {
    const attachment = await this.prisma.refundAttachment.findFirst({
      where: { id: attachmentId, refundId, deletedAt: null },
      select: { ...attachmentSelect, storageKey: true },
    });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    return attachment;
  }

  private publicView(attachment: AttachmentRecord) {
    return {
      id: attachment.id,
      refundId: attachment.refundId,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      uploadedByRole: attachment.uploadedByRole,
      uploadedBy: attachment.uploadedBy,
      createdAt: attachment.createdAt,
    };
  }

  private audit(
    transaction: Prisma.TransactionClient,
    action: string,
    refundId: string,
    actor: AuthenticatedUser,
    metadata: Prisma.InputJsonObject,
  ) {
    return transaction.auditLog.create({
      data: {
        actorUserId: actor.id,
        action,
        entityType: 'Refund',
        entityId: refundId,
        metadata: { ...metadata, actorRole: actor.role },
      },
    });
  }
}
