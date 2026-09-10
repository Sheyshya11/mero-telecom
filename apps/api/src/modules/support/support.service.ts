import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InternalRequestLevel,
  InternalRequestStatus,
  Prisma,
  Role,
  SupportEmailDeliveryStatus,
  SupportMessageVisibility,
  SupportPriority,
  SupportRequestType,
  SupportStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';

import type { UploadedPrivateFile } from '../../common/files/private-file.types';
import { buildPaginationMeta } from '../../common/pagination';
import {
  type BlockingInternalRequest,
  TicketWorkflowPolicyService,
} from '../../common/workflow/ticket-workflow-policy.service';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationService } from '../notifications/notification.service';
import {
  CreatePublicEnquiryDto,
  CreateSupportCaseDto,
  SupportCaseQueryDto,
} from './dto/support.dto';
import { SupportAttachmentsService } from './support-attachments.service';

const caseListSelect = {
  id: true,
  caseNumber: true,
  requestType: true,
  category: true,
  subject: true,
  status: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  closedAt: true,
  prospectName: true,
  prospectEmail: true,
  prospectPhone: true,
  prospectAddress: true,
  linkedCustomerAt: true,
  customer: {
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  },
  assignedTo: {
    select: { id: true, displayName: true, email: true, isActive: true, status: true },
  },
} satisfies Prisma.SupportCaseSelect;

const caseDetailSelect = {
  ...caseListSelect,
  messages: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      body: true,
      senderRole: true,
      visibility: true,
      emailDeliveryStatus: true,
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
} satisfies Prisma.SupportCaseSelect;

const customerCaseDetailSelect = {
  ...caseListSelect,
  messages: {
    where: { visibility: SupportMessageVisibility.CUSTOMER_VISIBLE },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: caseDetailSelect.messages.select,
  },
} satisfies Prisma.SupportCaseSelect;

const allowedStatusTransitions: Record<SupportStatus, readonly SupportStatus[]> = {
  OPEN: [SupportStatus.IN_PROGRESS, SupportStatus.WAITING_FOR_CUSTOMER, SupportStatus.RESOLVED],
  IN_PROGRESS: [SupportStatus.WAITING_FOR_CUSTOMER, SupportStatus.RESOLVED],
  WAITING_FOR_CUSTOMER: [SupportStatus.IN_PROGRESS, SupportStatus.RESOLVED],
  RESOLVED: [SupportStatus.IN_PROGRESS, SupportStatus.CLOSED],
  CLOSED: [],
};

const blockingInternalRequestWhere = {
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
} satisfies Prisma.InternalRequestWhereInput;

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: SupportAttachmentsService,
    private readonly notifications: NotificationService,
    private readonly workflow: TicketWorkflowPolicyService,
  ) {}

  async create(
    input: CreateSupportCaseDto,
    actor: AuthenticatedUser,
    files: UploadedPrivateFile[] = [],
  ) {
    await this.attachments.validate(files);
    const created = await this.prisma.$transaction(async (transaction) => {
      const customer = await transaction.customer.findUnique({
        where: { userId: actor.id },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      if (!customer) throw new NotFoundException('No customer profile is linked to this account.');
      const now = new Date();
      const sequence = await transaction.supportCaseSequence.upsert({
        where: { year: now.getUTCFullYear() },
        create: { year: now.getUTCFullYear(), value: 1 },
        update: { value: { increment: 1 } },
        select: { value: true },
      });
      const supportCase = await transaction.supportCase.create({
        data: {
          caseNumber: `SUP-${now.getUTCFullYear()}-${String(sequence.value).padStart(5, '0')}`,
          requestType: SupportRequestType.CUSTOMER_SUPPORT,
          customerId: customer.id,
          category: input.category,
          subject: input.subject,
        },
        select: { id: true, caseNumber: true },
      });
      const message = await transaction.supportMessage.create({
        data: {
          supportCaseId: supportCase.id,
          senderUserId: actor.id,
          senderRole: Role.CUSTOMER,
          body: input.message,
        },
        select: { id: true },
      });
      await this.attachments.createForMessage(transaction, supportCase.id, message.id, files);
      await this.audit(transaction, 'SUPPORT_CASE_CREATED', supportCase.id, actor, {
        caseNumber: supportCase.caseNumber,
        category: input.category,
        attachmentCount: files.length,
      });
      return { ...supportCase, customer };
    });

    await this.notifySafely(() =>
      this.notifications.sendNewSupportCase({
        caseNumber: created.caseNumber,
        customerName: `${created.customer.firstName} ${created.customer.lastName}`,
        customerEmail: created.customer.email,
        subject: input.subject,
      }),
    );
    return this.findMineOne(created.caseNumber, actor);
  }

  async createPublicEnquiry(input: CreatePublicEnquiryDto, idempotencyKey?: string) {
    const normalizedKey = idempotencyKey?.trim();
    if (normalizedKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(normalizedKey)) {
      throw new BadRequestException('The submission key is invalid. Please refresh and try again.');
    }
    const timeBucket = Math.floor(Date.now() / (10 * 60 * 1000));
    const submissionHash = createHash('sha256')
      .update(
        normalizedKey ||
          [input.email, input.category, input.subject, input.message, timeBucket].join('\u001f'),
      )
      .digest('hex');

    const existing = await this.prisma.supportCase.findUnique({
      where: { publicSubmissionKeyHash: submissionHash },
      select: { caseNumber: true },
    });
    if (existing) return this.publicSubmissionResponse(existing.caseNumber);

    let created: { id: string; caseNumber: string };
    try {
      created = await this.prisma.$transaction(async (transaction) => {
        const now = new Date();
        const sequence = await transaction.supportCaseSequence.upsert({
          where: { year: now.getUTCFullYear() },
          create: { year: now.getUTCFullYear(), value: 1 },
          update: { value: { increment: 1 } },
          select: { value: true },
        });
        const supportCase = await transaction.supportCase.create({
          data: {
            caseNumber: `MT-E-${now.getUTCFullYear()}-${String(sequence.value).padStart(5, '0')}`,
            requestType: SupportRequestType.PROSPECT_ENQUIRY,
            prospectName: input.name,
            prospectEmail: input.email,
            prospectPhone: input.phone || null,
            prospectAddress: input.address || null,
            publicSubmissionKeyHash: submissionHash,
            category: input.category,
            subject: input.subject,
          },
          select: { id: true, caseNumber: true },
        });
        await transaction.supportMessage.create({
          data: {
            supportCaseId: supportCase.id,
            senderUserId: null,
            senderRole: Role.CUSTOMER,
            visibility: SupportMessageVisibility.CUSTOMER_VISIBLE,
            body: input.message,
          },
        });
        await transaction.auditLog.create({
          data: {
            action: 'PROSPECT_ENQUIRY_CREATED',
            entityType: 'SupportCase',
            entityId: supportCase.id,
            metadata: {
              caseNumber: supportCase.caseNumber,
              requestType: SupportRequestType.PROSPECT_ENQUIRY,
              category: input.category,
              source: 'PUBLIC_HELP_FORM',
            },
          },
        });
        return supportCase;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.supportCase.findUnique({
          where: { publicSubmissionKeyHash: submissionHash },
          select: { caseNumber: true },
        });
        if (duplicate) return this.publicSubmissionResponse(duplicate.caseNumber);
      }
      throw error;
    }

    await Promise.all([
      this.notifySafely(() =>
        this.notifications.sendNewProspectEnquiry({
          caseNumber: created.caseNumber,
          prospectName: input.name,
          prospectEmail: input.email,
          subject: input.subject,
          category: input.category,
        }),
      ),
      this.notifySafely(() =>
        this.notifications.sendProspectEnquiryReceipt({
          caseNumber: created.caseNumber,
          prospectName: input.name,
          prospectEmail: input.email,
        }),
      ),
    ]);
    return this.publicSubmissionResponse(created.caseNumber);
  }

  async findMine(query: SupportCaseQueryDto, actor: AuthenticatedUser) {
    const result = await this.findCases(query, { customer: { userId: actor.id } });
    return { ...result, data: result.data.map((supportCase) => this.customerView(supportCase)) };
  }

  findAll(query: SupportCaseQueryDto, actor: AuthenticatedUser) {
    const assignment: Prisma.SupportCaseWhereInput =
      query.assignment === 'UNASSIGNED'
        ? { assignedToUserId: null }
        : query.assignment === 'MINE'
          ? { assignedToUserId: actor.id }
          : {};
    return this.findCases(query, assignment);
  }

  async findMineOne(caseNumber: string, actor: AuthenticatedUser) {
    const supportCase = await this.prisma.supportCase.findFirst({
      where: { caseNumber, customer: { userId: actor.id } },
      select: customerCaseDetailSelect,
    });
    if (!supportCase) throw new NotFoundException('Support request not found.');
    return this.customerView(supportCase);
  }

  async findOne(caseNumber: string, actor: AuthenticatedUser) {
    const supportCase = await this.prisma.supportCase.findUnique({
      where: { caseNumber },
      select: caseDetailSelect,
    });
    if (!supportCase) throw new NotFoundException('Support request not found.');
    const blockers = await this.blockingInternalRequests(supportCase.id);
    const activity = await this.activity(supportCase.id, supportCase.caseNumber);
    const capabilities = this.workflow.supportCaseCapabilities(
      {
        status: supportCase.status,
        assignedToUserId: supportCase.assignedTo?.id ?? null,
        assignedToAvailable:
          !supportCase.assignedTo ||
          (supportCase.assignedTo.isActive && supportCase.assignedTo.status === 'ACTIVE'),
      },
      actor,
      blockers,
    );
    return {
      ...supportCase,
      capabilities,
      workflow: {
        resolutionBlockedReason: capabilities.resolutionBlockedReason,
        blockingInternalRequests: blockers,
      },
      activity,
    };
  }

  async replyAsCustomer(
    caseNumber: string,
    body: string,
    actor: AuthenticatedUser,
    files: UploadedPrivateFile[] = [],
  ) {
    await this.attachments.validate(files);
    const existing = await this.prisma.supportCase.findFirst({
      where: { caseNumber, customer: { userId: actor.id } },
      select: { id: true, status: true, assignedTo: { select: { email: true } } },
    });
    if (!existing) throw new NotFoundException('Support request not found.');
    if (existing.status === SupportStatus.CLOSED) {
      throw new ConflictException('This support request is closed and cannot receive replies.');
    }
    const reopens =
      existing.status === SupportStatus.WAITING_FOR_CUSTOMER ||
      existing.status === SupportStatus.RESOLVED;
    const message = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.supportMessage.create({
        data: {
          supportCaseId: existing.id,
          senderUserId: actor.id,
          senderRole: Role.CUSTOMER,
          body,
        },
        select: { id: true },
      });
      await this.attachments.createForMessage(transaction, existing.id, created.id, files);
      await transaction.supportCase.update({
        where: { id: existing.id },
        data: {
          status: reopens ? SupportStatus.IN_PROGRESS : undefined,
          resolvedAt: reopens ? null : undefined,
        },
      });
      await this.audit(transaction, 'SUPPORT_CUSTOMER_REPLIED', existing.id, actor, {
        caseNumber,
        previousStatus: existing.status,
        newStatus: reopens ? SupportStatus.IN_PROGRESS : existing.status,
        attachmentCount: files.length,
      });
      return created;
    });
    if (existing.assignedTo?.email) {
      await this.notifySafely(() =>
        this.notifications.sendAssignedSupportReply({
          caseNumber,
          staffEmail: existing.assignedTo!.email,
        }),
      );
    }
    return { messageId: message.id, supportCase: await this.findMineOne(caseNumber, actor) };
  }

  async take(caseNumber: string, actor: AuthenticatedUser) {
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.supportCase.updateMany({
        where: {
          caseNumber,
          OR: [
            { assignedToUserId: null },
            { assignedTo: { is: { OR: [{ isActive: false }, { status: { not: 'ACTIVE' } }] } } },
          ],
          status: { not: SupportStatus.CLOSED },
        },
        data: { assignedToUserId: actor.id, status: SupportStatus.IN_PROGRESS },
      });
      const current = await transaction.supportCase.findUnique({
        where: { caseNumber },
        select: { id: true, assignedToUserId: true, status: true },
      });
      if (!current) throw new NotFoundException('Support request not found.');
      if (!result.count && current.status === SupportStatus.CLOSED) {
        throw new ConflictException('A closed support request cannot be assigned.');
      }
      if (!result.count && current.assignedToUserId !== actor.id) {
        throw new ConflictException('This support request has already been assigned.');
      }
      if (result.count) {
        await this.audit(transaction, 'SUPPORT_CASE_ASSIGNED', current.id, actor, {
          caseNumber,
          assignedToUserId: actor.id,
        });
      }
      return current;
    });
    return this.findOne(caseNumber, actor);
  }

  async replyAsStaff(
    caseNumber: string,
    body: string,
    actor: AuthenticatedUser,
    files: UploadedPrivateFile[] = [],
  ) {
    await this.attachments.validate(files);
    const existing = await this.prisma.supportCase.findUnique({
      where: { caseNumber },
      select: {
        id: true,
        status: true,
        requestType: true,
        prospectName: true,
        prospectEmail: true,
        customer: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!existing) throw new NotFoundException('Support request not found.');
    if (existing.requestType === SupportRequestType.PROSPECT_ENQUIRY && files.length) {
      throw new BadRequestException(
        'Attachments are not available for prospect email replies. Add a secure internal note instead.',
      );
    }
    if (existing.status === SupportStatus.CLOSED) {
      throw new ConflictException('This support request is closed and cannot receive replies.');
    }
    const message = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.supportMessage.create({
        data: {
          supportCaseId: existing.id,
          senderUserId: actor.id,
          senderRole: actor.role,
          visibility: SupportMessageVisibility.CUSTOMER_VISIBLE,
          emailDeliveryStatus: SupportEmailDeliveryStatus.QUEUED,
          body,
        },
        select: { id: true },
      });
      await this.attachments.createForMessage(transaction, existing.id, created.id, files);
      await transaction.supportCase.update({
        where: { id: existing.id },
        data: { updatedAt: new Date() },
      });
      await this.audit(transaction, 'SUPPORT_STAFF_REPLIED', existing.id, actor, {
        caseNumber,
        attachmentCount: files.length,
      });
      return created;
    });
    await this.sendExternalUpdate(existing, message.id, 'STAFF_REPLIED', caseNumber, body);
    return { messageId: message.id, supportCase: await this.findOne(caseNumber, actor) };
  }

  async addInternalNote(caseNumber: string, body: string, actor: AuthenticatedUser) {
    const existing = await this.prisma.supportCase.findUnique({
      where: { caseNumber },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Support request not found.');
    if (existing.status === SupportStatus.CLOSED) {
      throw new ConflictException('This support request is closed and cannot receive notes.');
    }
    const note = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.supportMessage.create({
        data: {
          supportCaseId: existing.id,
          senderUserId: actor.id,
          senderRole: actor.role,
          visibility: SupportMessageVisibility.INTERNAL,
          body,
        },
        select: { id: true },
      });
      await transaction.supportCase.update({
        where: { id: existing.id },
        data: { updatedAt: new Date() },
      });
      await this.audit(transaction, 'SUPPORT_INTERNAL_NOTE_ADDED', existing.id, actor, {
        caseNumber,
      });
      return created;
    });
    return { messageId: note.id, supportCase: await this.findOne(caseNumber, actor) };
  }

  async linkProspectToCustomer(
    caseNumber: string,
    customerNumber: string,
    actor: AuthenticatedUser,
  ) {
    const [identity, customer] = await Promise.all([
      this.prisma.supportCase.findUnique({ where: { caseNumber }, select: { id: true } }),
      this.prisma.customer.findUnique({
        where: { customerNumber },
        select: { id: true, customerNumber: true },
      }),
    ]);
    if (!identity) throw new NotFoundException('Support request not found.');
    if (!customer) throw new NotFoundException('Customer not found.');
    await this.prisma.$transaction(async (transaction) => {
      await this.lockSupportCase(transaction, identity.id);
      const current = await transaction.supportCase.findUniqueOrThrow({
        where: { id: identity.id },
        select: {
          requestType: true,
          customerId: true,
          assignedToUserId: true,
          status: true,
        },
      });
      if (current.requestType !== SupportRequestType.PROSPECT_ENQUIRY) {
        throw new ConflictException('Only a prospect enquiry can be linked to a customer.');
      }
      this.workflow.assertCanLinkSupportCustomer(current, actor);
      if (current.customerId === customer.id) return;
      if (current.customerId) {
        throw new ConflictException('This enquiry is already linked to a different customer.');
      }
      const updated = await transaction.supportCase.updateMany({
        where: { id: identity.id, customerId: null },
        data: {
          customerId: customer.id,
          linkedCustomerAt: new Date(),
          linkedCustomerByUserId: actor.id,
        },
      });
      if (!updated.count) {
        throw new ConflictException('This enquiry was linked by another user. Refresh and retry.');
      }
      await this.audit(transaction, 'PROSPECT_ENQUIRY_LINKED_TO_CUSTOMER', identity.id, actor, {
        caseNumber,
        customerNumber: customer.customerNumber,
      });
    });
    return this.findOne(caseNumber, actor);
  }

  async changeStatus(caseNumber: string, status: SupportStatus, actor: AuthenticatedUser) {
    if (status === SupportStatus.RESOLVED) {
      throw new ConflictException(
        'Use the resolve action and provide a customer-facing resolution summary.',
      );
    }
    const identity = await this.prisma.supportCase.findUnique({
      where: { caseNumber },
      select: { id: true },
    });
    if (!identity) throw new NotFoundException('Support request not found.');
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await this.lockSupportCase(transaction, identity.id);
      const locked = await transaction.supportCase.findUniqueOrThrow({
        where: { id: identity.id },
        select: {
          id: true,
          status: true,
          assignedToUserId: true,
          requestType: true,
          prospectName: true,
          prospectEmail: true,
          customer: { select: { firstName: true, lastName: true, email: true } },
        },
      });
      if (locked.status === status) return { current: locked, changed: false };
      const blockers =
        status === SupportStatus.CLOSED
          ? await this.blockingInternalRequests(locked.id, transaction)
          : [];
      if (status === SupportStatus.CLOSED) {
        this.workflow.assertCanCloseSupport(locked, actor, blockers);
      } else {
        this.workflow.assertSupportOwner(locked, actor);
      }
      if (!allowedStatusTransitions[locked.status].includes(status)) {
        throw new ConflictException(
          `A ${locked.status.toLowerCase()} request cannot move to ${status.toLowerCase()}.`,
        );
      }
      const updated = await transaction.supportCase.updateMany({
        where: { id: locked.id, status: locked.status, assignedToUserId: actor.id },
        data: {
          status,
          resolvedAt: status === SupportStatus.IN_PROGRESS ? null : undefined,
          closedAt: status === SupportStatus.CLOSED ? new Date() : undefined,
        },
      });
      if (!updated.count) {
        throw new ConflictException(
          'This support request changed and the action can no longer be completed.',
        );
      }
      await this.audit(transaction, 'SUPPORT_STATUS_CHANGED', locked.id, actor, {
        caseNumber,
        previousStatus: locked.status,
        newStatus: status,
      });
      return { current: locked, changed: true };
    });
    if (outcome.changed && status === SupportStatus.WAITING_FOR_CUSTOMER) {
      await this.sendExternalUpdate(outcome.current, null, status, caseNumber);
    }
    return this.findOne(caseNumber, actor);
  }

  async resolve(caseNumber: string, resolutionNote: string, actor: AuthenticatedUser) {
    const identity = await this.prisma.supportCase.findUnique({
      where: { caseNumber },
      select: { id: true },
    });
    if (!identity) throw new NotFoundException('Support request not found.');
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await this.lockSupportCase(transaction, identity.id);
      const locked = await transaction.supportCase.findUniqueOrThrow({
        where: { id: identity.id },
        select: {
          id: true,
          status: true,
          assignedToUserId: true,
          requestType: true,
          prospectName: true,
          prospectEmail: true,
          customer: { select: { firstName: true, lastName: true, email: true } },
        },
      });
      const blockers = await this.blockingInternalRequests(locked.id, transaction);
      this.workflow.assertSupportOwner(locked, actor);
      if (locked.status === SupportStatus.RESOLVED) return { current: locked, changed: false };
      this.workflow.assertCanResolveSupport(locked, actor, blockers);
      const resolutionMessage = await transaction.supportMessage.create({
        data: {
          supportCaseId: locked.id,
          senderUserId: actor.id,
          senderRole: actor.role,
          visibility: SupportMessageVisibility.CUSTOMER_VISIBLE,
          emailDeliveryStatus: SupportEmailDeliveryStatus.QUEUED,
          body: resolutionNote,
        },
        select: { id: true },
      });
      await this.audit(transaction, 'SUPPORT_STAFF_REPLIED', locked.id, actor, {
        caseNumber,
        resolutionNote: true,
      });
      const updated = await transaction.supportCase.updateMany({
        where: {
          id: locked.id,
          status: locked.status,
          assignedToUserId: actor.id,
        },
        data: { status: SupportStatus.RESOLVED, resolvedAt: new Date() },
      });
      if (!updated.count) {
        throw new ConflictException(
          'This support request changed and the action can no longer be completed.',
        );
      }
      await this.audit(transaction, 'SUPPORT_CASE_RESOLVED', locked.id, actor, {
        caseNumber,
        previousStatus: locked.status,
        resolutionSummaryRecorded: true,
      });
      return { current: locked, changed: true, messageId: resolutionMessage.id };
    });
    if (outcome.changed) {
      await this.sendExternalUpdate(
        outcome.current,
        outcome.messageId ?? null,
        'RESOLVED',
        caseNumber,
        resolutionNote,
      );
    }
    return this.findOne(caseNumber, actor);
  }

  async changePriority(caseNumber: string, priority: SupportPriority, actor: AuthenticatedUser) {
    const identity = await this.prisma.supportCase.findUnique({
      where: { caseNumber },
      select: { id: true },
    });
    if (!identity) throw new NotFoundException('Support request not found.');
    await this.prisma.$transaction(async (transaction) => {
      await this.lockSupportCase(transaction, identity.id);
      const current = await transaction.supportCase.findUniqueOrThrow({
        where: { id: identity.id },
        select: { id: true, priority: true, status: true, assignedToUserId: true },
      });
      this.workflow.assertSupportOwner(current, actor);
      if (current.status === SupportStatus.CLOSED) {
        throw new ConflictException('A closed support request cannot be changed.');
      }
      const updated = await transaction.supportCase.updateMany({
        where: {
          id: current.id,
          priority: current.priority,
          status: current.status,
          assignedToUserId: actor.id,
        },
        data: { priority },
      });
      if (!updated.count) {
        throw new ConflictException(
          'This support request changed and the action can no longer be completed.',
        );
      }
      await this.audit(transaction, 'SUPPORT_PRIORITY_CHANGED', current.id, actor, {
        caseNumber,
        previousPriority: current.priority,
        newPriority: priority,
      });
    });
    return this.findOne(caseNumber, actor);
  }

  async summary(actor: AuthenticatedUser) {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const [
      newRequests,
      assignedToMe,
      waitingForCustomer,
      resolvedToday,
      openCustomerTickets,
      openEnquiries,
      unassignedEnquiries,
    ] = await this.prisma.$transaction([
      this.prisma.supportCase.count({ where: { status: SupportStatus.OPEN } }),
      this.prisma.supportCase.count({
        where: {
          assignedToUserId: actor.id,
          status: { in: [SupportStatus.IN_PROGRESS, SupportStatus.WAITING_FOR_CUSTOMER] },
        },
      }),
      this.prisma.supportCase.count({ where: { status: SupportStatus.WAITING_FOR_CUSTOMER } }),
      this.prisma.supportCase.count({
        where: { status: SupportStatus.RESOLVED, resolvedAt: { gte: startOfToday } },
      }),
      this.prisma.supportCase.count({
        where: {
          requestType: SupportRequestType.CUSTOMER_SUPPORT,
          status: {
            in: [SupportStatus.OPEN, SupportStatus.IN_PROGRESS, SupportStatus.WAITING_FOR_CUSTOMER],
          },
        },
      }),
      this.prisma.supportCase.count({
        where: {
          requestType: SupportRequestType.PROSPECT_ENQUIRY,
          status: {
            in: [SupportStatus.OPEN, SupportStatus.IN_PROGRESS, SupportStatus.WAITING_FOR_CUSTOMER],
          },
        },
      }),
      this.prisma.supportCase.count({
        where: {
          requestType: SupportRequestType.PROSPECT_ENQUIRY,
          status: SupportStatus.OPEN,
          assignedToUserId: null,
        },
      }),
    ]);
    return {
      newRequests,
      assignedToMe,
      waitingForCustomer,
      resolvedToday,
      openCustomerTickets,
      openEnquiries,
      unassignedEnquiries,
    };
  }

  private async findCases(query: SupportCaseQueryDto, baseWhere: Prisma.SupportCaseWhereInput) {
    const search = query.search?.trim();
    const where: Prisma.SupportCaseWhereInput = {
      AND: [
        baseWhere,
        ...(query.status ? [{ status: query.status }] : []),
        ...(query.category ? [{ category: query.category }] : []),
        ...(query.requestType ? [{ requestType: query.requestType }] : []),
        ...(search
          ? [
              {
                OR: [
                  { caseNumber: { contains: search, mode: 'insensitive' as const } },
                  { subject: { contains: search, mode: 'insensitive' as const } },
                  { prospectName: { contains: search, mode: 'insensitive' as const } },
                  { prospectEmail: { contains: search, mode: 'insensitive' as const } },
                  {
                    customer: {
                      is: { firstName: { contains: search, mode: 'insensitive' as const } },
                    },
                  },
                  {
                    customer: {
                      is: { lastName: { contains: search, mode: 'insensitive' as const } },
                    },
                  },
                  {
                    customer: { is: { email: { contains: search, mode: 'insensitive' as const } } },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    const skip = (query.page - 1) * query.limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.supportCase.findMany({
        where,
        select: caseListSelect,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.supportCase.count({ where }),
    ]);
    return { data, meta: buildPaginationMeta(query, total) };
  }

  private audit(
    transaction: Prisma.TransactionClient,
    action: string,
    supportCaseId: string,
    actor: AuthenticatedUser,
    metadata: Prisma.InputJsonObject,
  ) {
    return transaction.auditLog.create({
      data: {
        actorUserId: actor.id,
        action,
        entityType: 'SupportCase',
        entityId: supportCaseId,
        metadata: { ...metadata, actorRole: actor.role },
      },
    });
  }

  private async blockingInternalRequests(
    supportCaseId: string,
    transaction: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<BlockingInternalRequest[]> {
    return transaction.internalRequest.findMany({
      where: { supportCaseId, ...blockingInternalRequestWhere },
      select: { requestNumber: true, currentLevel: true, status: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
  }

  private async lockSupportCase(
    transaction: Prisma.TransactionClient,
    supportCaseId: string,
  ): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "SupportCase" WHERE "id" = ${supportCaseId}::uuid FOR UPDATE`,
    );
  }

  private publicSubmissionResponse(caseNumber: string) {
    return {
      referenceNumber: caseNumber,
      message: 'Thanks for contacting Mero Telecom. Our support team will review your enquiry.',
    };
  }

  private async activity(supportCaseId: string, caseNumber: string) {
    const records = await this.prisma.auditLog.findMany({
      where: { entityType: 'SupportCase', entityId: { in: [supportCaseId, caseNumber] } },
      select: {
        id: true,
        action: true,
        metadata: true,
        createdAt: true,
        actor: { select: { displayName: true, email: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 250,
    });
    return records.map((record) => ({
      id: record.id,
      action: record.action,
      createdAt: record.createdAt,
      actorName: record.actor?.displayName || record.actor?.email || 'Mero Telecom system',
      metadata: record.metadata,
    }));
  }

  private async sendExternalUpdate(
    supportCase: {
      requestType: SupportRequestType;
      prospectName: string | null;
      prospectEmail: string | null;
      customer: { firstName: string; lastName: string; email: string } | null;
    },
    messageId: string | null,
    event: 'STAFF_REPLIED' | 'WAITING_FOR_CUSTOMER' | 'RESOLVED',
    caseNumber: string,
    messageBody?: string,
  ): Promise<void> {
    try {
      if (supportCase.requestType === SupportRequestType.PROSPECT_ENQUIRY) {
        if (!supportCase.prospectName || !supportCase.prospectEmail) {
          throw new Error('Prospect contact is unavailable');
        }
        await this.notifications.sendProspectSupportUpdate({
          event,
          caseNumber,
          prospectName: supportCase.prospectName,
          prospectEmail: supportCase.prospectEmail,
          supportMessageId: messageId ?? undefined,
          messageBody,
        });
      } else {
        if (!supportCase.customer) throw new Error('Customer contact is unavailable');
        await this.notifications.sendSupportCustomerUpdate({
          event,
          caseNumber,
          customerName: `${supportCase.customer.firstName} ${supportCase.customer.lastName}`,
          customerEmail: supportCase.customer.email,
          supportMessageId: messageId ?? undefined,
        });
      }
    } catch (error) {
      if (messageId) {
        await this.prisma.supportMessage.updateMany({
          where: { id: messageId, emailDeliveryStatus: SupportEmailDeliveryStatus.QUEUED },
          data: { emailDeliveryStatus: SupportEmailDeliveryStatus.FAILED },
        });
      }
      this.logger.warn(
        JSON.stringify({
          event: 'support_external_notification_failed',
          caseNumber,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  private customerView<T extends Record<string, unknown>>(supportCase: T) {
    const assignedTo = supportCase.assignedTo;
    const messages = supportCase.messages;
    const safeCase = Object.fromEntries(
      Object.entries(supportCase).filter(
        ([key]) =>
          ![
            'customer',
            'assignedTo',
            'messages',
            'prospectEmail',
            'prospectName',
            'prospectPhone',
            'prospectAddress',
          ].includes(key),
      ),
    );
    return {
      ...safeCase,
      assignedTo:
        assignedTo && typeof assignedTo === 'object' && 'displayName' in assignedTo
          ? { displayName: assignedTo.displayName }
          : null,
      ...(Array.isArray(messages)
        ? {
            messages: messages.map((message: Record<string, unknown>) =>
              Object.fromEntries(Object.entries(message).filter(([key]) => key !== 'sender')),
            ),
          }
        : {}),
    };
  }

  private async notifySafely(action: () => Promise<unknown> | null): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'support_notification_failed',
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }
}
