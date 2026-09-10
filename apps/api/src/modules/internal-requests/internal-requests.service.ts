import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InternalRequestEventType,
  InternalRequestLevel,
  InternalRequestPriority,
  InternalRequestStatus,
  Prisma,
  Role,
  SupportStatus,
} from '@prisma/client';

import type { UploadedPrivateFile } from '../../common/files/private-file.types';
import { buildPaginationMeta } from '../../common/pagination';
import { TicketWorkflowPolicyService } from '../../common/workflow/ticket-workflow-policy.service';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationService } from '../notifications/notification.service';
import {
  CreateInternalRequestDto,
  EscalateInternalRequestDto,
  InternalRequestContextQueryDto,
  InternalRequestQueryDto,
} from './dto/internal-request.dto';
import { InternalRequestAttachmentsService } from './internal-request-attachments.service';

const internalRequestListSelect = {
  id: true,
  requestNumber: true,
  requesterRole: true,
  targetRole: true,
  currentLevel: true,
  type: true,
  title: true,
  priority: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
  resolvedAt: true,
  closedAt: true,
  requestedBy: { select: { id: true, displayName: true, email: true } },
  assignedTo: {
    select: { id: true, displayName: true, email: true, isActive: true, status: true },
  },
  superAdminAssignedTo: {
    select: { id: true, displayName: true, email: true, isActive: true, status: true },
  },
  reviewedBy: { select: { id: true, displayName: true, email: true } },
  escalatedBy: { select: { id: true, displayName: true, email: true } },
  escalatedAt: true,
  customer: {
    select: { id: true, customerNumber: true, firstName: true, lastName: true, email: true },
  },
  supportCase: { select: { id: true, caseNumber: true, subject: true, status: true } },
  subscription: {
    select: { id: true, status: true, plan: { select: { id: true, name: true } } },
  },
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      totalCents: true,
      currency: true,
    },
  },
  payment: {
    select: {
      id: true,
      providerPaymentId: true,
      status: true,
      amountCents: true,
      currency: true,
    },
  },
  refund: {
    select: { id: true, status: true, reason: true, refundAmountCents: true, currency: true },
  },
  planChangeRequest: {
    select: {
      id: true,
      status: true,
      type: true,
      targetPlan: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.InternalRequestSelect;

const internalRequestDetailSelect = {
  ...internalRequestListSelect,
  description: true,
  messages: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      body: true,
      senderRole: true,
      createdAt: true,
      updatedAt: true,
      sender: { select: { id: true, displayName: true, email: true } },
      attachments: {
        orderBy: { createdAt: 'asc' as const },
        select: {
          id: true,
          messageId: true,
          originalName: true,
          mimeType: true,
          fileSize: true,
          createdAt: true,
        },
      },
    },
  },
  events: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      eventType: true,
      actorRole: true,
      fromLevel: true,
      toLevel: true,
      comment: true,
      createdAt: true,
      actor: { select: { id: true, displayName: true, email: true } },
    },
  },
} satisfies Prisma.InternalRequestSelect;

type StaffNotificationEvent =
  | 'REVIEW_STARTED'
  | 'MORE_INFO_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ADMIN_REPLIED'
  | 'RESOLVED'
  | 'CLOSED'
  | 'ESCALATED'
  | 'SUPER_ADMIN_REPLIED'
  | 'SUPER_ADMIN_REVIEW_STARTED'
  | 'SUPER_ADMIN_MORE_INFO_REQUIRED'
  | 'SUPER_ADMIN_APPROVED'
  | 'SUPER_ADMIN_REJECTED'
  | 'RETURNED_TO_ADMIN';

type SuperAdminNotificationEvent = 'ESCALATED' | 'ADMIN_REPLIED' | 'STAFF_REPLIED';

type AdminEscalationNotificationEvent =
  | 'SUPER_ADMIN_REPLIED'
  | 'MORE_INFO_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'RESOLVED'
  | 'CLOSED';

@Injectable()
export class InternalRequestsService {
  private readonly logger = new Logger(InternalRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: InternalRequestAttachmentsService,
    private readonly notifications: NotificationService,
    private readonly workflow: TicketWorkflowPolicyService,
  ) {}

  async create(input: CreateInternalRequestDto, actor: AuthenticatedUser) {
    const created = await this.prisma.$transaction(async (transaction) => {
      if (input.supportCaseId) await this.lockSupportCase(transaction, input.supportCaseId);
      const relationships = await this.validateRelationships(transaction, input, actor);
      if (relationships.supportCaseId) {
        const existing = await transaction.internalRequest.findFirst({
          where: {
            supportCaseId: relationships.supportCaseId,
            OR: [
              {
                status: {
                  in: [
                    InternalRequestStatus.PENDING,
                    InternalRequestStatus.IN_REVIEW,
                    InternalRequestStatus.MORE_INFO_REQUIRED,
                    InternalRequestStatus.APPROVED,
                  ],
                },
              },
              {
                currentLevel: InternalRequestLevel.SUPER_ADMIN,
                status: InternalRequestStatus.REJECTED,
              },
            ],
          },
          select: { requestNumber: true },
        });
        if (existing) {
          throw new ConflictException(
            `An unfinished internal request already exists for this ticket (${existing.requestNumber}).`,
          );
        }
      }
      const now = new Date();
      const year = now.getUTCFullYear();
      const sequence = await transaction.internalRequestSequence.upsert({
        where: { year },
        create: { year, value: 1 },
        update: { value: { increment: 1 } },
        select: { value: true },
      });
      const internalRequest = await transaction.internalRequest.create({
        data: {
          requestNumber: `IR-${year}-${String(sequence.value).padStart(5, '0')}`,
          requestedByUserId: actor.id,
          requesterRole: Role.STAFF,
          targetRole: Role.ADMIN,
          type: input.type,
          title: input.title,
          description: input.description,
          priority: input.priority,
          ...relationships,
        },
        select: {
          id: true,
          requestNumber: true,
          priority: true,
          type: true,
          requestedBy: { select: { displayName: true, email: true } },
        },
      });
      await this.event(transaction, internalRequest.id, actor, InternalRequestEventType.CREATED, {
        toLevel: InternalRequestLevel.ADMIN,
      });
      await this.audit(transaction, 'INTERNAL_REQUEST_CREATED', internalRequest.id, actor, {
        requestNumber: internalRequest.requestNumber,
        type: input.type,
        priority: input.priority,
        linkedEntityTypes: this.linkedEntityTypes(relationships),
      });
      return internalRequest;
    });

    await this.notifySafely(() =>
      this.notifications.sendNewInternalRequest({
        requestNumber: created.requestNumber,
        requesterName: created.requestedBy.displayName || created.requestedBy.email,
        type: created.type,
        priority: created.priority,
      }),
    );
    return this.findMineOne(created.requestNumber, actor);
  }

  findMine(query: InternalRequestQueryDto, actor: AuthenticatedUser) {
    return this.findRequests(query, {
      requestedByUserId: actor.id,
      requesterRole: Role.STAFF,
      targetRole: Role.ADMIN,
    });
  }

  findAll(query: InternalRequestQueryDto, actor: AuthenticatedUser) {
    const assignment: Prisma.InternalRequestWhereInput =
      query.assignment === 'UNASSIGNED'
        ? { assignedToUserId: null }
        : query.assignment === 'MINE'
          ? { assignedToUserId: actor.id }
          : {};
    return this.findRequests(query, { targetRole: Role.ADMIN, ...assignment }, true);
  }

  async findMineOne(requestNumber: string, actor: AuthenticatedUser) {
    const internalRequest = await this.prisma.internalRequest.findFirst({
      where: {
        requestNumber,
        requestedByUserId: actor.id,
        requesterRole: Role.STAFF,
        targetRole: Role.ADMIN,
      },
      select: internalRequestDetailSelect,
    });
    if (!internalRequest) throw new NotFoundException('Internal request not found.');
    return this.withCapabilities(internalRequest, actor);
  }

  async findOne(requestNumber: string, actor: AuthenticatedUser) {
    const internalRequest = await this.prisma.internalRequest.findFirst({
      where: { requestNumber, targetRole: Role.ADMIN },
      select: internalRequestDetailSelect,
    });
    if (!internalRequest) throw new NotFoundException('Internal request not found.');
    return this.withCapabilities(internalRequest, actor);
  }

  async take(requestNumber: string, actor: AuthenticatedUser) {
    this.workflow.assertAdminActor(actor);
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.internalRequest.updateMany({
        where: {
          requestNumber,
          targetRole: Role.ADMIN,
          currentLevel: InternalRequestLevel.ADMIN,
          OR: [
            { assignedToUserId: null },
            { assignedTo: { is: { OR: [{ isActive: false }, { status: { not: 'ACTIVE' } }] } } },
          ],
          status: InternalRequestStatus.PENDING,
        },
        data: { assignedToUserId: actor.id },
      });
      const current = await transaction.internalRequest.findFirst({
        where: { requestNumber, targetRole: Role.ADMIN },
        select: { id: true, assignedToUserId: true, status: true, currentLevel: true },
      });
      if (!current) throw new NotFoundException('Internal request not found.');
      const requester = await transaction.internalRequest.findUniqueOrThrow({
        where: { id: current.id },
        select: { requestedByUserId: true },
      });
      this.workflow.assertNotSelfDecision(requester, actor);
      if (!result.count && current.status !== InternalRequestStatus.PENDING) {
        throw new ConflictException('Only a pending internal request can be assigned.');
      }
      if (!result.count && current.currentLevel === InternalRequestLevel.SUPER_ADMIN) {
        throw new ConflictException('This request is currently being reviewed by Super Admin.');
      }
      if (!result.count && current.assignedToUserId !== actor.id) {
        throw new ConflictException(
          'This request has already been assigned to another administrator.',
        );
      }
      if (result.count) {
        await this.event(transaction, current.id, actor, InternalRequestEventType.ASSIGNED, {
          toLevel: InternalRequestLevel.ADMIN,
        });
        await this.audit(transaction, 'INTERNAL_REQUEST_TAKEN', current.id, actor, {
          requestNumber,
          assignedToUserId: actor.id,
        });
      }
    });
    return this.findOne(requestNumber, actor);
  }

  async replyAsStaff(
    requestNumber: string,
    body: string,
    actor: AuthenticatedUser,
    files: UploadedPrivateFile[] = [],
  ) {
    await this.attachments.validate(files);
    const current = await this.prisma.internalRequest.findFirst({
      where: {
        requestNumber,
        requestedByUserId: actor.id,
        requesterRole: Role.STAFF,
        targetRole: Role.ADMIN,
      },
      select: {
        id: true,
        status: true,
        assignedTo: { select: { email: true } },
        superAdminAssignedTo: { select: { email: true } },
        currentLevel: true,
      },
    });
    if (!current) throw new NotFoundException('Internal request not found.');
    if (
      current.status === InternalRequestStatus.RESOLVED ||
      current.status === InternalRequestStatus.CLOSED
    ) {
      throw new ConflictException('This internal request is read-only.');
    }
    const resumesReview = current.status === InternalRequestStatus.MORE_INFO_REQUIRED;
    await this.prisma.$transaction(async (transaction) => {
      const message = await transaction.internalRequestMessage.create({
        data: {
          internalRequestId: current.id,
          senderUserId: actor.id,
          senderRole: Role.STAFF,
          body,
        },
        select: { id: true },
      });
      await this.attachments.createForMessage(transaction, current.id, message.id, files);
      const updated = await transaction.internalRequest.updateMany({
        where: { id: current.id, status: current.status },
        data: {
          status: resumesReview ? InternalRequestStatus.IN_REVIEW : undefined,
          updatedAt: new Date(),
        },
      });
      if (!updated.count) {
        throw new ConflictException('This request changed while you were replying. Please retry.');
      }
      await this.event(transaction, current.id, actor, InternalRequestEventType.MESSAGE_SENT, {
        fromLevel: current.currentLevel,
        toLevel: current.currentLevel,
      });
      await this.audit(transaction, 'INTERNAL_REQUEST_STAFF_REPLIED', current.id, actor, {
        requestNumber,
        previousStatus: current.status,
        newStatus: resumesReview ? InternalRequestStatus.IN_REVIEW : current.status,
        currentLevel: current.currentLevel,
        attachmentCount: files.length,
      });
    });
    if (
      current.currentLevel === InternalRequestLevel.SUPER_ADMIN &&
      current.superAdminAssignedTo?.email
    ) {
      await this.notifySafely(() =>
        this.notifications.sendInternalRequestSuperAdminUpdate({
          event: 'STAFF_REPLIED',
          requestNumber,
          superAdminEmail: current.superAdminAssignedTo!.email,
          priority: undefined,
        }),
      );
    } else if (current.assignedTo?.email) {
      await this.notifySafely(() =>
        this.notifications.sendAssignedInternalRequestReply({
          requestNumber,
          adminEmail: current.assignedTo!.email,
          resumedReview: resumesReview,
        }),
      );
    }
    return this.findMineOne(requestNumber, actor);
  }

  async replyAsAdmin(
    requestNumber: string,
    body: string,
    actor: AuthenticatedUser,
    files: UploadedPrivateFile[] = [],
  ) {
    await this.attachments.validate(files);
    const current = await this.ownedAdminRequest(requestNumber, actor, true);
    if (
      (
        [InternalRequestStatus.RESOLVED, InternalRequestStatus.CLOSED] as InternalRequestStatus[]
      ).includes(current.status)
    ) {
      throw new ConflictException('This internal request is read-only.');
    }
    await this.prisma.$transaction(async (transaction) => {
      const message = await transaction.internalRequestMessage.create({
        data: {
          internalRequestId: current.id,
          senderUserId: actor.id,
          senderRole: actor.role,
          body,
        },
        select: { id: true },
      });
      await this.attachments.createForMessage(transaction, current.id, message.id, files);
      const resumesReview =
        current.currentLevel === InternalRequestLevel.SUPER_ADMIN &&
        current.status === InternalRequestStatus.MORE_INFO_REQUIRED;
      const updated = await transaction.internalRequest.updateMany({
        where: { id: current.id, status: current.status, currentLevel: current.currentLevel },
        data: {
          status: resumesReview ? InternalRequestStatus.IN_REVIEW : undefined,
          updatedAt: new Date(),
        },
      });
      if (!updated.count) {
        throw new ConflictException('This request changed while you were replying. Please retry.');
      }
      await this.event(transaction, current.id, actor, InternalRequestEventType.MESSAGE_SENT, {
        fromLevel: current.currentLevel,
        toLevel: current.currentLevel,
      });
      await this.audit(transaction, 'INTERNAL_REQUEST_ADMIN_REPLIED', current.id, actor, {
        requestNumber,
        currentLevel: current.currentLevel,
        attachmentCount: files.length,
      });
    });
    if (current.currentLevel === InternalRequestLevel.SUPER_ADMIN) {
      await this.notifySuperAdmins(current, 'ADMIN_REPLIED');
    }
    await this.notifyStaff(current, 'ADMIN_REPLIED');
    return this.findOne(requestNumber, actor);
  }

  startReview(requestNumber: string, actor: AuthenticatedUser) {
    return this.transition(requestNumber, actor, {
      from: [InternalRequestStatus.PENDING],
      to: InternalRequestStatus.IN_REVIEW,
      action: 'INTERNAL_REQUEST_REVIEW_STARTED',
      notification: 'REVIEW_STARTED',
      reviewed: true,
    });
  }

  requestInformation(requestNumber: string, comment: string, actor: AuthenticatedUser) {
    return this.transition(requestNumber, actor, {
      from: [InternalRequestStatus.IN_REVIEW],
      to: InternalRequestStatus.MORE_INFO_REQUIRED,
      action: 'INTERNAL_REQUEST_INFORMATION_REQUESTED',
      notification: 'MORE_INFO_REQUIRED',
      comment,
      reviewed: true,
    });
  }

  approve(requestNumber: string, comment: string | undefined, actor: AuthenticatedUser) {
    return this.transition(requestNumber, actor, {
      from: [InternalRequestStatus.IN_REVIEW],
      to: InternalRequestStatus.APPROVED,
      action: 'INTERNAL_REQUEST_APPROVED',
      notification: 'APPROVED',
      comment,
      reviewed: true,
    });
  }

  reject(requestNumber: string, comment: string, actor: AuthenticatedUser) {
    return this.transition(requestNumber, actor, {
      from: [InternalRequestStatus.IN_REVIEW],
      to: InternalRequestStatus.REJECTED,
      action: 'INTERNAL_REQUEST_REJECTED',
      notification: 'REJECTED',
      comment,
      reviewed: true,
    });
  }

  async escalate(
    requestNumber: string,
    input: EscalateInternalRequestDto,
    actor: AuthenticatedUser,
  ) {
    const current = await this.ownedAdminRequest(requestNumber, actor);
    if (current.status !== InternalRequestStatus.IN_REVIEW) {
      throw new ConflictException('Only a request in review can be escalated to Super Admin.');
    }
    await this.prisma.$transaction(async (transaction) => {
      if (input.comment) {
        const message = await transaction.internalRequestMessage.create({
          data: {
            internalRequestId: current.id,
            senderUserId: actor.id,
            senderRole: Role.ADMIN,
            body: input.comment,
          },
          select: { id: true },
        });
        await this.event(transaction, current.id, actor, InternalRequestEventType.MESSAGE_SENT, {
          fromLevel: InternalRequestLevel.ADMIN,
          toLevel: InternalRequestLevel.ADMIN,
        });
        void message;
      }
      const updated = await transaction.internalRequest.updateMany({
        where: {
          id: current.id,
          assignedToUserId: actor.id,
          currentLevel: InternalRequestLevel.ADMIN,
          status: InternalRequestStatus.IN_REVIEW,
        },
        data: {
          currentLevel: InternalRequestLevel.SUPER_ADMIN,
          status: InternalRequestStatus.PENDING,
          priority: input.priority,
          superAdminAssignedToUserId: null,
          escalatedByUserId: actor.id,
          escalatedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      if (!updated.count) {
        throw new ConflictException('This request has already been escalated or changed.');
      }
      await this.event(transaction, current.id, actor, InternalRequestEventType.ESCALATED, {
        fromLevel: InternalRequestLevel.ADMIN,
        toLevel: InternalRequestLevel.SUPER_ADMIN,
        comment: input.reason,
      });
      await this.audit(
        transaction,
        'INTERNAL_REQUEST_ESCALATED_TO_SUPER_ADMIN',
        current.id,
        actor,
        {
          requestNumber,
          fromLevel: InternalRequestLevel.ADMIN,
          toLevel: InternalRequestLevel.SUPER_ADMIN,
          priority: input.priority,
          reasonRecorded: true,
          commentAdded: Boolean(input.comment),
        },
      );
    });
    const updated = await this.findOne(requestNumber, actor);
    await this.notifySuperAdmins(updated, 'ESCALATED');
    await this.notifyStaff(updated, 'ESCALATED');
    return updated;
  }

  resolve(requestNumber: string, comment: string, actor: AuthenticatedUser) {
    return this.transition(requestNumber, actor, {
      from: [InternalRequestStatus.APPROVED],
      to: InternalRequestStatus.RESOLVED,
      action: 'INTERNAL_REQUEST_RESOLVED',
      notification: 'RESOLVED',
      comment,
      resolved: true,
    });
  }

  close(requestNumber: string, comment: string | undefined, actor: AuthenticatedUser) {
    return this.transition(requestNumber, actor, {
      from: [InternalRequestStatus.REJECTED, InternalRequestStatus.RESOLVED],
      to: InternalRequestStatus.CLOSED,
      action: 'INTERNAL_REQUEST_CLOSED',
      notification: 'CLOSED',
      comment,
      closed: true,
    });
  }

  findEscalations(query: InternalRequestQueryDto, actor: AuthenticatedUser) {
    const assignment: Prisma.InternalRequestWhereInput =
      query.assignment === 'UNASSIGNED'
        ? { superAdminAssignedToUserId: null }
        : query.assignment === 'MINE'
          ? { superAdminAssignedToUserId: actor.id }
          : {};
    return this.findRequests(
      query,
      { events: { some: { eventType: InternalRequestEventType.ESCALATED } }, ...assignment },
      true,
    );
  }

  async findEscalation(requestNumber: string, actor: AuthenticatedUser) {
    const internalRequest = await this.prisma.internalRequest.findFirst({
      where: {
        requestNumber,
        events: { some: { eventType: InternalRequestEventType.ESCALATED } },
      },
      select: internalRequestDetailSelect,
    });
    if (!internalRequest) throw new NotFoundException('Escalated internal request not found.');
    return this.withCapabilities(internalRequest, actor);
  }

  async takeEscalation(requestNumber: string, actor: AuthenticatedUser) {
    this.workflow.assertSuperAdminActor(actor);
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.internalRequest.updateMany({
        where: {
          requestNumber,
          currentLevel: InternalRequestLevel.SUPER_ADMIN,
          OR: [
            { superAdminAssignedToUserId: null },
            {
              superAdminAssignedTo: {
                is: { OR: [{ isActive: false }, { status: { not: 'ACTIVE' } }] },
              },
            },
          ],
          status: InternalRequestStatus.PENDING,
        },
        data: { superAdminAssignedToUserId: actor.id },
      });
      const current = await transaction.internalRequest.findUnique({
        where: { requestNumber },
        select: {
          id: true,
          currentLevel: true,
          status: true,
          superAdminAssignedToUserId: true,
        },
      });
      if (!current || current.currentLevel !== InternalRequestLevel.SUPER_ADMIN) {
        throw new NotFoundException('Escalated internal request not found.');
      }
      const requester = await transaction.internalRequest.findUniqueOrThrow({
        where: { id: current.id },
        select: { requestedByUserId: true },
      });
      this.workflow.assertNotSelfDecision(requester, actor);
      if (!result.count && current.status !== InternalRequestStatus.PENDING) {
        throw new ConflictException('Only a pending escalation can be assigned.');
      }
      if (!result.count && current.superAdminAssignedToUserId !== actor.id) {
        throw new ConflictException(
          'This escalation has already been assigned to another Super Administrator.',
        );
      }
      if (result.count) {
        await this.event(transaction, current.id, actor, InternalRequestEventType.ASSIGNED, {
          toLevel: InternalRequestLevel.SUPER_ADMIN,
        });
        await this.audit(transaction, 'INTERNAL_REQUEST_SUPER_ADMIN_ASSIGNED', current.id, actor, {
          requestNumber,
          assignedToUserId: actor.id,
          currentLevel: InternalRequestLevel.SUPER_ADMIN,
        });
      }
    });
    return this.findEscalation(requestNumber, actor);
  }

  async replyAsSuperAdmin(
    requestNumber: string,
    body: string,
    actor: AuthenticatedUser,
    files: UploadedPrivateFile[] = [],
  ) {
    await this.attachments.validate(files);
    const current = await this.ownedSuperAdminRequest(requestNumber, actor);
    if (
      (
        [InternalRequestStatus.RESOLVED, InternalRequestStatus.CLOSED] as InternalRequestStatus[]
      ).includes(current.status)
    ) {
      throw new ConflictException('This internal request is read-only.');
    }
    await this.prisma.$transaction(async (transaction) => {
      const message = await transaction.internalRequestMessage.create({
        data: {
          internalRequestId: current.id,
          senderUserId: actor.id,
          senderRole: Role.SUPER_ADMIN,
          body,
        },
        select: { id: true },
      });
      await this.attachments.createForMessage(transaction, current.id, message.id, files);
      const updated = await transaction.internalRequest.updateMany({
        where: {
          id: current.id,
          currentLevel: InternalRequestLevel.SUPER_ADMIN,
          status: current.status,
        },
        data: { updatedAt: new Date() },
      });
      if (!updated.count) {
        throw new ConflictException('This request changed while you were replying. Please retry.');
      }
      await this.event(transaction, current.id, actor, InternalRequestEventType.MESSAGE_SENT, {
        fromLevel: InternalRequestLevel.SUPER_ADMIN,
        toLevel: InternalRequestLevel.SUPER_ADMIN,
      });
      await this.audit(transaction, 'INTERNAL_REQUEST_SUPER_ADMIN_REPLIED', current.id, actor, {
        requestNumber,
        attachmentCount: files.length,
      });
    });
    await this.notifyAdminAndStaff(current, 'SUPER_ADMIN_REPLIED', 'SUPER_ADMIN_REPLIED');
    return this.findEscalation(requestNumber, actor);
  }

  startSuperAdminReview(requestNumber: string, actor: AuthenticatedUser) {
    return this.superAdminTransition(requestNumber, actor, {
      from: [InternalRequestStatus.PENDING],
      to: InternalRequestStatus.IN_REVIEW,
      action: 'INTERNAL_REQUEST_SUPER_ADMIN_REVIEW_STARTED',
      event: InternalRequestEventType.REVIEW_STARTED,
      adminNotification: 'SUPER_ADMIN_REPLIED',
      staffNotification: 'SUPER_ADMIN_REVIEW_STARTED',
      reviewed: true,
    });
  }

  requestSuperAdminInformation(requestNumber: string, comment: string, actor: AuthenticatedUser) {
    return this.superAdminTransition(requestNumber, actor, {
      from: [InternalRequestStatus.IN_REVIEW],
      to: InternalRequestStatus.MORE_INFO_REQUIRED,
      action: 'INTERNAL_REQUEST_SUPER_ADMIN_INFORMATION_REQUESTED',
      event: InternalRequestEventType.MORE_INFO_REQUESTED,
      adminNotification: 'MORE_INFO_REQUIRED',
      staffNotification: 'SUPER_ADMIN_MORE_INFO_REQUIRED',
      comment,
      reviewed: true,
    });
  }

  superAdminApprove(requestNumber: string, comment: string | undefined, actor: AuthenticatedUser) {
    return this.superAdminTransition(requestNumber, actor, {
      from: [InternalRequestStatus.IN_REVIEW],
      to: InternalRequestStatus.APPROVED,
      action: 'INTERNAL_REQUEST_SUPER_ADMIN_APPROVED',
      event: InternalRequestEventType.APPROVED,
      adminNotification: 'APPROVED',
      staffNotification: 'SUPER_ADMIN_APPROVED',
      comment,
      reviewed: true,
    });
  }

  superAdminReject(requestNumber: string, comment: string, actor: AuthenticatedUser) {
    return this.superAdminTransition(requestNumber, actor, {
      from: [InternalRequestStatus.IN_REVIEW],
      to: InternalRequestStatus.REJECTED,
      action: 'INTERNAL_REQUEST_SUPER_ADMIN_REJECTED',
      event: InternalRequestEventType.REJECTED,
      adminNotification: 'REJECTED',
      staffNotification: 'SUPER_ADMIN_REJECTED',
      comment,
      reviewed: true,
    });
  }

  async returnToAdmin(requestNumber: string, comment: string, actor: AuthenticatedUser) {
    const current = await this.ownedSuperAdminRequest(requestNumber, actor);
    if (
      !(
        [
          InternalRequestStatus.IN_REVIEW,
          InternalRequestStatus.MORE_INFO_REQUIRED,
          InternalRequestStatus.APPROVED,
          InternalRequestStatus.REJECTED,
        ] as InternalRequestStatus[]
      ).includes(current.status)
    ) {
      throw new ConflictException('This escalation cannot be returned from its current state.');
    }
    const returnedStatus =
      current.status === InternalRequestStatus.MORE_INFO_REQUIRED
        ? InternalRequestStatus.IN_REVIEW
        : current.status;
    await this.prisma.$transaction(async (transaction) => {
      const message = await transaction.internalRequestMessage.create({
        data: {
          internalRequestId: current.id,
          senderUserId: actor.id,
          senderRole: Role.SUPER_ADMIN,
          body: comment,
        },
        select: { id: true },
      });
      const updated = await transaction.internalRequest.updateMany({
        where: {
          id: current.id,
          currentLevel: InternalRequestLevel.SUPER_ADMIN,
          superAdminAssignedToUserId: actor.id,
          status: current.status,
        },
        data: {
          currentLevel: InternalRequestLevel.ADMIN,
          status: returnedStatus,
          updatedAt: new Date(),
        },
      });
      if (!updated.count) {
        throw new ConflictException('This request has already been returned or changed.');
      }
      await this.event(transaction, current.id, actor, InternalRequestEventType.MESSAGE_SENT, {
        fromLevel: InternalRequestLevel.SUPER_ADMIN,
        toLevel: InternalRequestLevel.SUPER_ADMIN,
      });
      await this.event(transaction, current.id, actor, InternalRequestEventType.RETURNED, {
        fromLevel: InternalRequestLevel.SUPER_ADMIN,
        toLevel: InternalRequestLevel.ADMIN,
        comment,
      });
      await this.audit(transaction, 'INTERNAL_REQUEST_RETURNED_TO_ADMIN', current.id, actor, {
        requestNumber,
        fromLevel: InternalRequestLevel.SUPER_ADMIN,
        toLevel: InternalRequestLevel.ADMIN,
        previousStatus: current.status,
        newStatus: returnedStatus,
        commentAdded: true,
        messageId: message.id,
      });
    });
    const updated = await this.findOne(requestNumber, actor);
    await this.notifyAdminAndStaff(updated, 'RETURNED', 'RETURNED_TO_ADMIN');
    return updated;
  }

  superAdminResolve(
    _requestNumber: string,
    _comment: string | undefined,
    actor: AuthenticatedUser,
  ) {
    this.workflow.assertSuperAdminActor(actor);
    throw new ConflictException(
      'Super Admin decisions must be returned to Admin for operational execution before resolution.',
    );
  }

  superAdminClose(_requestNumber: string, _comment: string | undefined, actor: AuthenticatedUser) {
    this.workflow.assertSuperAdminActor(actor);
    throw new ConflictException(
      'Return this escalation to Admin before closing the internal request.',
    );
  }

  async staffSummary(actor: AuthenticatedUser) {
    const [myOpenRequests, needsMyResponse, approved, escalated, recentlyResolved] =
      await this.prisma.$transaction([
        this.prisma.internalRequest.count({
          where: {
            requestedByUserId: actor.id,
            targetRole: Role.ADMIN,
            status: {
              in: [
                InternalRequestStatus.PENDING,
                InternalRequestStatus.IN_REVIEW,
                InternalRequestStatus.MORE_INFO_REQUIRED,
                InternalRequestStatus.APPROVED,
              ],
            },
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            requestedByUserId: actor.id,
            targetRole: Role.ADMIN,
            status: InternalRequestStatus.MORE_INFO_REQUIRED,
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            requestedByUserId: actor.id,
            targetRole: Role.ADMIN,
            status: InternalRequestStatus.APPROVED,
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            requestedByUserId: actor.id,
            currentLevel: InternalRequestLevel.SUPER_ADMIN,
            status: { notIn: [InternalRequestStatus.RESOLVED, InternalRequestStatus.CLOSED] },
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            requestedByUserId: actor.id,
            status: InternalRequestStatus.RESOLVED,
            resolvedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000) },
          },
        }),
      ]);
    return {
      myOpenRequests,
      myPendingRequests: myOpenRequests,
      needsMyResponse,
      approved,
      escalated,
      recentlyResolved,
    };
  }

  async adminSummary(actor: AuthenticatedUser) {
    const [awaitingReview, assignedToMe, needsInformation, highPriority, escalated] =
      await this.prisma.$transaction([
        this.prisma.internalRequest.count({
          where: {
            targetRole: Role.ADMIN,
            currentLevel: InternalRequestLevel.ADMIN,
            status: InternalRequestStatus.PENDING,
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            targetRole: Role.ADMIN,
            assignedToUserId: actor.id,
            currentLevel: InternalRequestLevel.ADMIN,
            status: {
              in: [
                InternalRequestStatus.PENDING,
                InternalRequestStatus.IN_REVIEW,
                InternalRequestStatus.MORE_INFO_REQUIRED,
                InternalRequestStatus.APPROVED,
              ],
            },
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            targetRole: Role.ADMIN,
            currentLevel: InternalRequestLevel.ADMIN,
            status: InternalRequestStatus.MORE_INFO_REQUIRED,
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            targetRole: Role.ADMIN,
            currentLevel: InternalRequestLevel.ADMIN,
            priority: InternalRequestPriority.HIGH,
            status: { notIn: [InternalRequestStatus.RESOLVED, InternalRequestStatus.CLOSED] },
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            targetRole: Role.ADMIN,
            currentLevel: InternalRequestLevel.SUPER_ADMIN,
            status: { notIn: [InternalRequestStatus.RESOLVED, InternalRequestStatus.CLOSED] },
          },
        }),
      ]);
    return { awaitingReview, assignedToMe, needsInformation, highPriority, escalated };
  }

  async superAdminSummary(actor: AuthenticatedUser) {
    const [awaitingReview, assignedToMe, inReview, needsInformation, highPriority] =
      await this.prisma.$transaction([
        this.prisma.internalRequest.count({
          where: {
            currentLevel: InternalRequestLevel.SUPER_ADMIN,
            status: InternalRequestStatus.PENDING,
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            currentLevel: InternalRequestLevel.SUPER_ADMIN,
            superAdminAssignedToUserId: actor.id,
            status: { notIn: [InternalRequestStatus.RESOLVED, InternalRequestStatus.CLOSED] },
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            currentLevel: InternalRequestLevel.SUPER_ADMIN,
            status: InternalRequestStatus.IN_REVIEW,
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            currentLevel: InternalRequestLevel.SUPER_ADMIN,
            status: InternalRequestStatus.MORE_INFO_REQUIRED,
          },
        }),
        this.prisma.internalRequest.count({
          where: {
            currentLevel: InternalRequestLevel.SUPER_ADMIN,
            priority: InternalRequestPriority.HIGH,
            status: { notIn: [InternalRequestStatus.RESOLVED, InternalRequestStatus.CLOSED] },
          },
        }),
      ]);
    return { awaitingReview, assignedToMe, inReview, needsInformation, highPriority };
  }

  requesters() {
    return this.prisma.user.findMany({
      where: {
        internalRequestsCreated: { some: { targetRole: Role.ADMIN } },
        roles: { some: { role: Role.STAFF } },
      },
      select: { id: true, displayName: true, email: true },
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
      take: 100,
    });
  }

  async contextOptions(query: InternalRequestContextQueryDto) {
    let selectedCustomerId = query.customerId;
    let selectedSupportCaseId: string | null = null;
    if (query.supportCaseNumber) {
      const supportCase = await this.prisma.supportCase.findUnique({
        where: { caseNumber: query.supportCaseNumber },
        select: { id: true, customerId: true },
      });
      if (!supportCase) throw new NotFoundException('Related support request not found.');
      if (
        selectedCustomerId &&
        supportCase.customerId &&
        selectedCustomerId !== supportCase.customerId
      ) {
        throw new BadRequestException('The related support request belongs to another customer.');
      }
      selectedCustomerId = supportCase.customerId ?? undefined;
      selectedSupportCaseId = supportCase.id;
    }

    const search = query.search?.trim();
    const customers = await this.prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { customerNumber: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : selectedCustomerId
          ? { id: selectedCustomerId }
          : {},
      select: { id: true, customerNumber: true, firstName: true, lastName: true, email: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 20,
    });

    if (!selectedCustomerId) {
      return {
        selectedCustomerId: null,
        selectedSupportCaseId,
        customers,
        supportCases: [],
        invoices: [],
        payments: [],
        refunds: [],
        subscriptions: [],
        planChanges: [],
      };
    }
    const customerExists = customers.some((customer) => customer.id === selectedCustomerId);
    if (!customerExists) throw new NotFoundException('Related customer not found.');

    const [supportCases, invoices, payments, refunds, subscriptions, planChanges] =
      await this.prisma.$transaction([
        this.prisma.supportCase.findMany({
          where: { customerId: selectedCustomerId },
          select: { id: true, caseNumber: true, subject: true, status: true },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        }),
        this.prisma.invoice.findMany({
          where: { customerId: selectedCustomerId },
          select: { id: true, invoiceNumber: true, status: true, totalCents: true, currency: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.payment.findMany({
          where: { customerId: selectedCustomerId },
          select: {
            id: true,
            providerPaymentId: true,
            status: true,
            amountCents: true,
            currency: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.refund.findMany({
          where: { customerId: selectedCustomerId },
          select: { id: true, status: true, reason: true, refundAmountCents: true, currency: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.subscription.findMany({
          where: { customerId: selectedCustomerId },
          select: { id: true, status: true, plan: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.planChangeRequest.findMany({
          where: { customerId: selectedCustomerId },
          select: {
            id: true,
            status: true,
            type: true,
            targetPlan: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      ]);
    return {
      selectedCustomerId,
      selectedSupportCaseId,
      customers,
      supportCases,
      invoices,
      payments,
      refunds,
      subscriptions,
      planChanges,
    };
  }

  private async findRequests(
    query: InternalRequestQueryDto,
    baseWhere: Prisma.InternalRequestWhereInput,
    adminQueue = false,
  ) {
    const search = query.search?.trim();
    const where: Prisma.InternalRequestWhereInput = {
      AND: [
        baseWhere,
        ...(query.status ? [{ status: query.status }] : []),
        ...(query.type ? [{ type: query.type }] : []),
        ...(query.priority ? [{ priority: query.priority }] : []),
        ...(query.currentLevel ? [{ currentLevel: query.currentLevel }] : []),
        ...(query.requestedByUserId ? [{ requestedByUserId: query.requestedByUserId }] : []),
        ...(search
          ? [
              {
                OR: [
                  { requestNumber: { contains: search, mode: 'insensitive' as const } },
                  { title: { contains: search, mode: 'insensitive' as const } },
                  { customer: { firstName: { contains: search, mode: 'insensitive' as const } } },
                  { customer: { lastName: { contains: search, mode: 'insensitive' as const } } },
                  { customer: { email: { contains: search, mode: 'insensitive' as const } } },
                ],
              },
            ]
          : []),
      ],
    };
    const skip = (query.page - 1) * query.limit;
    const orderBy: Prisma.InternalRequestOrderByWithRelationInput[] = adminQueue
      ? [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }]
      : [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }];
    const [data, total] = await this.prisma.$transaction([
      this.prisma.internalRequest.findMany({
        where,
        select: internalRequestListSelect,
        orderBy,
        skip,
        take: query.limit,
      }),
      this.prisma.internalRequest.count({ where }),
    ]);
    return { data, meta: buildPaginationMeta(query, total) };
  }

  private async ownedAdminRequest(
    requestNumber: string,
    actor: AuthenticatedUser,
    allowEscalated = false,
  ) {
    this.workflow.assertAdminActor(actor);
    const current = await this.prisma.internalRequest.findFirst({
      where: { requestNumber, targetRole: Role.ADMIN },
      select: {
        id: true,
        requestedByUserId: true,
        status: true,
        currentLevel: true,
        priority: true,
        assignedToUserId: true,
        superAdminAssignedTo: { select: { email: true } },
        assignedTo: { select: { email: true } },
        requestedBy: { select: { displayName: true, email: true } },
      },
    });
    if (!current) throw new NotFoundException('Internal request not found.');
    this.workflow.assertNotSelfDecision(current, actor);
    if (!current.assignedToUserId) {
      throw new ConflictException('Take this request before performing review actions.');
    }
    if (current.assignedToUserId !== actor.id) {
      throw new ConflictException('This request is assigned to another administrator.');
    }
    if (!allowEscalated && current.currentLevel === InternalRequestLevel.SUPER_ADMIN) {
      throw new ConflictException('This request is currently being reviewed by Super Admin.');
    }
    return current;
  }

  private async transition(
    requestNumber: string,
    actor: AuthenticatedUser,
    input: {
      from: InternalRequestStatus[];
      to: InternalRequestStatus;
      action: string;
      notification: StaffNotificationEvent;
      comment?: string;
      reviewed?: boolean;
      resolved?: boolean;
      closed?: boolean;
    },
  ) {
    const current = await this.ownedAdminRequest(requestNumber, actor);
    if (!input.from.includes(current.status)) {
      throw new ConflictException(
        `This request can no longer move from ${current.status.toLowerCase()} to ${input.to.toLowerCase()}.`,
      );
    }
    await this.prisma.$transaction(async (transaction) => {
      if (input.comment) {
        await transaction.internalRequestMessage.create({
          data: {
            internalRequestId: current.id,
            senderUserId: actor.id,
            senderRole: actor.role,
            body: input.comment,
          },
        });
        await this.event(transaction, current.id, actor, InternalRequestEventType.MESSAGE_SENT, {
          fromLevel: InternalRequestLevel.ADMIN,
          toLevel: InternalRequestLevel.ADMIN,
        });
      }
      const updated = await transaction.internalRequest.updateMany({
        where: {
          id: current.id,
          assignedToUserId: actor.id,
          currentLevel: InternalRequestLevel.ADMIN,
          status: { in: input.from },
        },
        data: {
          status: input.to,
          reviewedByUserId: input.reviewed ? actor.id : undefined,
          reviewedAt: input.reviewed ? new Date() : undefined,
          resolvedAt: input.resolved ? new Date() : undefined,
          closedAt: input.closed ? new Date() : undefined,
          updatedAt: new Date(),
        },
      });
      if (!updated.count) {
        throw new ConflictException(
          'This request has changed and the action can no longer be completed.',
        );
      }
      await this.event(transaction, current.id, actor, this.eventTypeForAction(input.action), {
        fromLevel: InternalRequestLevel.ADMIN,
        toLevel: InternalRequestLevel.ADMIN,
        comment: input.comment,
      });
      await this.audit(transaction, input.action, current.id, actor, {
        requestNumber,
        previousStatus: current.status,
        newStatus: input.to,
        currentLevel: InternalRequestLevel.ADMIN,
        commentAdded: Boolean(input.comment),
      });
    });
    await this.notifyStaff(current, input.notification);
    return this.findOne(requestNumber, actor);
  }

  private async ownedSuperAdminRequest(requestNumber: string, actor: AuthenticatedUser) {
    this.workflow.assertSuperAdminActor(actor);
    const current = await this.prisma.internalRequest.findUnique({
      where: { requestNumber },
      select: {
        id: true,
        requestedByUserId: true,
        status: true,
        currentLevel: true,
        priority: true,
        assignedTo: { select: { email: true } },
        superAdminAssignedToUserId: true,
        superAdminAssignedTo: { select: { email: true } },
        requestedBy: { select: { displayName: true, email: true } },
      },
    });
    if (!current || current.currentLevel !== InternalRequestLevel.SUPER_ADMIN) {
      throw new NotFoundException('Escalated internal request not found.');
    }
    this.workflow.assertNotSelfDecision(current, actor);
    if (!current.superAdminAssignedToUserId) {
      throw new ConflictException('Take this escalation before performing review actions.');
    }
    if (current.superAdminAssignedToUserId !== actor.id) {
      throw new ConflictException('This escalation is assigned to another Super Administrator.');
    }
    return current;
  }

  private async superAdminTransition(
    requestNumber: string,
    actor: AuthenticatedUser,
    input: {
      from: InternalRequestStatus[];
      to: InternalRequestStatus;
      action: string;
      event: InternalRequestEventType;
      adminNotification: AdminEscalationNotificationEvent;
      staffNotification: StaffNotificationEvent;
      comment?: string;
      reviewed?: boolean;
      resolved?: boolean;
      closed?: boolean;
    },
  ) {
    const current = await this.ownedSuperAdminRequest(requestNumber, actor);
    if (!input.from.includes(current.status)) {
      throw new ConflictException(
        `This request can no longer move from ${current.status.toLowerCase()} to ${input.to.toLowerCase()}.`,
      );
    }
    await this.prisma.$transaction(async (transaction) => {
      if (input.comment) {
        await transaction.internalRequestMessage.create({
          data: {
            internalRequestId: current.id,
            senderUserId: actor.id,
            senderRole: Role.SUPER_ADMIN,
            body: input.comment,
          },
        });
        await this.event(transaction, current.id, actor, InternalRequestEventType.MESSAGE_SENT, {
          fromLevel: InternalRequestLevel.SUPER_ADMIN,
          toLevel: InternalRequestLevel.SUPER_ADMIN,
        });
      }
      const updated = await transaction.internalRequest.updateMany({
        where: {
          id: current.id,
          currentLevel: InternalRequestLevel.SUPER_ADMIN,
          superAdminAssignedToUserId: actor.id,
          status: { in: input.from },
        },
        data: {
          status: input.to,
          reviewedByUserId: input.reviewed ? actor.id : undefined,
          reviewedAt: input.reviewed ? new Date() : undefined,
          resolvedAt: input.resolved ? new Date() : undefined,
          closedAt: input.closed ? new Date() : undefined,
          updatedAt: new Date(),
        },
      });
      if (!updated.count) {
        throw new ConflictException(
          'This request has changed and the action can no longer be completed.',
        );
      }
      await this.event(transaction, current.id, actor, input.event, {
        fromLevel: InternalRequestLevel.SUPER_ADMIN,
        toLevel: InternalRequestLevel.SUPER_ADMIN,
        comment: input.comment,
      });
      await this.audit(transaction, input.action, current.id, actor, {
        requestNumber,
        previousStatus: current.status,
        newStatus: input.to,
        currentLevel: InternalRequestLevel.SUPER_ADMIN,
        commentAdded: Boolean(input.comment),
      });
    });
    const updated = await this.findEscalation(requestNumber, actor);
    await this.notifyAdminAndStaff(updated, input.adminNotification, input.staffNotification);
    return updated;
  }

  private eventTypeForAction(action: string): InternalRequestEventType {
    const eventByAction: Record<string, InternalRequestEventType> = {
      INTERNAL_REQUEST_REVIEW_STARTED: InternalRequestEventType.REVIEW_STARTED,
      INTERNAL_REQUEST_INFORMATION_REQUESTED: InternalRequestEventType.MORE_INFO_REQUESTED,
      INTERNAL_REQUEST_APPROVED: InternalRequestEventType.APPROVED,
      INTERNAL_REQUEST_REJECTED: InternalRequestEventType.REJECTED,
      INTERNAL_REQUEST_RESOLVED: InternalRequestEventType.RESOLVED,
      INTERNAL_REQUEST_CLOSED: InternalRequestEventType.CLOSED,
    };
    const event = eventByAction[action];
    if (!event) throw new Error(`Missing internal request event mapping for ${action}.`);
    return event;
  }

  private event(
    transaction: Prisma.TransactionClient,
    internalRequestId: string,
    actor: AuthenticatedUser,
    eventType: InternalRequestEventType,
    input: {
      fromLevel?: InternalRequestLevel;
      toLevel?: InternalRequestLevel;
      comment?: string;
    } = {},
  ) {
    return transaction.internalRequestEvent.create({
      data: {
        internalRequestId,
        actorUserId: actor.id,
        actorRole: actor.role,
        eventType,
        fromLevel: input.fromLevel,
        toLevel: input.toLevel,
        comment: input.comment,
      },
    });
  }

  private async validateRelationships(
    transaction: Prisma.TransactionClient,
    input: CreateInternalRequestDto,
    actor: AuthenticatedUser,
  ): Promise<{
    customerId?: string;
    supportCaseId?: string;
    invoiceId?: string;
    paymentId?: string;
    refundId?: string;
    subscriptionId?: string;
    planChangeRequestId?: string;
  }> {
    const [customer, supportCase, invoice, payment, refund, subscription, planChange] =
      await Promise.all([
        input.customerId
          ? transaction.customer.findUnique({
              where: { id: input.customerId },
              select: { id: true },
            })
          : null,
        input.supportCaseId
          ? transaction.supportCase.findUnique({
              where: { id: input.supportCaseId },
              select: { id: true, customerId: true, assignedToUserId: true, status: true },
            })
          : null,
        input.invoiceId
          ? transaction.invoice.findUnique({
              where: { id: input.invoiceId },
              select: { id: true, customerId: true },
            })
          : null,
        input.paymentId
          ? transaction.payment.findUnique({
              where: { id: input.paymentId },
              select: { id: true, customerId: true },
            })
          : null,
        input.refundId
          ? transaction.refund.findUnique({
              where: { id: input.refundId },
              select: { id: true, customerId: true },
            })
          : null,
        input.subscriptionId
          ? transaction.subscription.findUnique({
              where: { id: input.subscriptionId },
              select: { id: true, customerId: true },
            })
          : null,
        input.planChangeRequestId
          ? transaction.planChangeRequest.findUnique({
              where: { id: input.planChangeRequestId },
              select: { id: true, customerId: true },
            })
          : null,
      ]);
    const checks: Array<[string | undefined, unknown, string]> = [
      [input.customerId, customer, 'customer'],
      [input.supportCaseId, supportCase, 'support request'],
      [input.invoiceId, invoice, 'invoice'],
      [input.paymentId, payment, 'payment'],
      [input.refundId, refund, 'refund'],
      [input.subscriptionId, subscription, 'subscription'],
      [input.planChangeRequestId, planChange, 'plan change request'],
    ];
    const missing = checks.find(([id, record]) => id && !record);
    if (missing) throw new BadRequestException(`The related ${missing[2]} was not found.`);
    if (supportCase?.assignedToUserId && supportCase.assignedToUserId !== actor.id) {
      throw new ConflictException('This support request is assigned to another Staff member.');
    }
    if (
      supportCase &&
      ([SupportStatus.RESOLVED, SupportStatus.CLOSED] as SupportStatus[]).includes(
        supportCase.status,
      )
    ) {
      throw new ConflictException('A resolved or closed support request cannot be escalated.');
    }

    const relatedCustomerIds = new Set(
      [
        customer?.id,
        supportCase?.customerId,
        invoice?.customerId,
        payment?.customerId,
        refund?.customerId,
        subscription?.customerId,
        planChange?.customerId,
      ].filter((id): id is string => Boolean(id)),
    );
    if (relatedCustomerIds.size > 1) {
      throw new BadRequestException('All related records must belong to the same customer.');
    }
    const customerId = relatedCustomerIds.values().next().value as string | undefined;
    return {
      ...(customerId ? { customerId } : {}),
      ...(supportCase ? { supportCaseId: supportCase.id } : {}),
      ...(invoice ? { invoiceId: invoice.id } : {}),
      ...(payment ? { paymentId: payment.id } : {}),
      ...(refund ? { refundId: refund.id } : {}),
      ...(subscription ? { subscriptionId: subscription.id } : {}),
      ...(planChange ? { planChangeRequestId: planChange.id } : {}),
    };
  }

  private linkedEntityTypes(relationships: Record<string, string | undefined>): string[] {
    return Object.entries(relationships)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key.replace(/Id$/, ''));
  }

  private withCapabilities<
    T extends {
      requestedBy: { id: string };
      assignedTo: { id: string; isActive: boolean; status: string } | null;
      superAdminAssignedTo: { id: string; isActive: boolean; status: string } | null;
      currentLevel: InternalRequestLevel;
      status: InternalRequestStatus;
    },
  >(
    request: T,
    actor: AuthenticatedUser,
  ): T & {
    capabilities: ReturnType<TicketWorkflowPolicyService['internalRequestCapabilities']>;
  } {
    return {
      ...request,
      capabilities: this.workflow.internalRequestCapabilities(
        {
          requestedByUserId: request.requestedBy.id,
          assignedToUserId: request.assignedTo?.id ?? null,
          superAdminAssignedToUserId: request.superAdminAssignedTo?.id ?? null,
          assignedToAvailable:
            !request.assignedTo ||
            (request.assignedTo.isActive && request.assignedTo.status === 'ACTIVE'),
          superAdminAssignedToAvailable:
            !request.superAdminAssignedTo ||
            (request.superAdminAssignedTo.isActive &&
              request.superAdminAssignedTo.status === 'ACTIVE'),
          currentLevel: request.currentLevel,
          status: request.status,
        },
        actor,
      ),
    };
  }

  private async lockSupportCase(
    transaction: Prisma.TransactionClient,
    supportCaseId: string,
  ): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "SupportCase" WHERE "id" = ${supportCaseId}::uuid FOR UPDATE`,
    );
  }

  private audit(
    transaction: Prisma.TransactionClient,
    action: string,
    internalRequestId: string,
    actor: AuthenticatedUser,
    metadata: Prisma.InputJsonObject,
  ) {
    return transaction.auditLog.create({
      data: {
        actorUserId: actor.id,
        action,
        entityType: 'InternalRequest',
        entityId: internalRequestId,
        metadata: { ...metadata, actorRole: actor.role },
      },
    });
  }

  private async notifySuperAdmins(
    request: {
      id: string;
      priority: InternalRequestPriority;
      superAdminAssignedTo: { email: string } | null;
    },
    event: SuperAdminNotificationEvent,
  ): Promise<void> {
    const current = await this.prisma.internalRequest.findUnique({
      where: { id: request.id },
      select: { requestNumber: true },
    });
    if (!current) return;
    const recipients = request.superAdminAssignedTo
      ? [request.superAdminAssignedTo]
      : await this.prisma.user.findMany({
          where: {
            isActive: true,
            status: 'ACTIVE',
            roles: { some: { role: Role.SUPER_ADMIN } },
          },
          select: { email: true },
          take: 100,
        });
    await Promise.all(
      recipients.map((recipient) =>
        this.notifySafely(() =>
          this.notifications.sendInternalRequestSuperAdminUpdate({
            event,
            requestNumber: current.requestNumber,
            superAdminEmail: recipient.email,
            priority: request.priority,
          }),
        ),
      ),
    );
  }

  private async notifyAdminAndStaff(
    request: {
      id: string;
      assignedTo: { email: string } | null;
      requestedBy: { displayName: string | null; email: string };
    },
    adminEvent: AdminEscalationNotificationEvent,
    staffEvent: StaffNotificationEvent,
  ): Promise<void> {
    const current = await this.prisma.internalRequest.findUnique({
      where: { id: request.id },
      select: { requestNumber: true },
    });
    if (!current) return;
    await Promise.all([
      request.assignedTo?.email
        ? this.notifySafely(() =>
            this.notifications.sendInternalRequestAdminEscalationUpdate({
              event: adminEvent,
              requestNumber: current.requestNumber,
              adminEmail: request.assignedTo!.email,
            }),
          )
        : Promise.resolve(),
      this.notifyStaff(request, staffEvent),
    ]);
  }

  private async notifyStaff(
    request: { id: string; requestedBy: { displayName: string | null; email: string } },
    event: StaffNotificationEvent,
  ): Promise<void> {
    const current = await this.prisma.internalRequest.findUnique({
      where: { id: request.id },
      select: { requestNumber: true },
    });
    if (!current) return;
    await this.notifySafely(() =>
      this.notifications.sendInternalRequestStaffUpdate({
        event,
        requestNumber: current.requestNumber,
        staffName: request.requestedBy.displayName || request.requestedBy.email,
        staffEmail: request.requestedBy.email,
      }),
    );
  }

  private async notifySafely(action: () => Promise<unknown> | null): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'internal_request_notification_failed',
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }
}
