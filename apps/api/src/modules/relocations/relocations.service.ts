import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AddressType,
  CancellationProviderStatus,
  CoverageResultStatus,
  InternalRequestEventType,
  InternalRequestLevel,
  InternalRequestStatus,
  InternalRequestType,
  PlanChangeStatus,
  Prisma,
  Role,
  ServiceProvisioningStatus,
  ServiceRelocationStatus,
  SubscriptionStatus,
} from '@prisma/client';

import { buildPaginationMeta } from '../../common/pagination';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CoverageService } from '../coverage/coverage.service';
import type { NormalizedAddressSuggestion } from '../coverage/coverage.types';
import { NotificationService } from '../notifications/notification.service';
import {
  RelocationOverrideAction,
  type CreateRelocationDto,
  type DemoRelocationOutcomeDto,
  type EscalateRelocationDto,
  type OverrideRelocationDto,
  type RelocationQueryDto,
  type RescheduleRelocationDto,
} from './dto/relocation.dto';
import {
  type RelocationDisconnectionResult,
  type RelocationProvisioningResult,
  ServiceRelocationProvider,
} from './providers/service-relocation.provider';

const activeRelocationStatuses: ServiceRelocationStatus[] = [
  ServiceRelocationStatus.AWAITING_CONFIRMATION,
  ServiceRelocationStatus.CONFIRMED,
  ServiceRelocationStatus.PROVISIONING,
  ServiceRelocationStatus.SCHEDULED,
  ServiceRelocationStatus.PARTIALLY_COMPLETED,
  ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED,
  ServiceRelocationStatus.FAILED,
];

const activePlanChangeStatuses: PlanChangeStatus[] = [
  PlanChangeStatus.PENDING,
  PlanChangeStatus.CHECKOUT_CREATED,
  PlanChangeStatus.PROCESSING,
  PlanChangeStatus.SCHEDULED,
];

const cancellableRelocationStatuses: ServiceRelocationStatus[] = [
  ServiceRelocationStatus.AWAITING_CONFIRMATION,
  ServiceRelocationStatus.CONFIRMED,
  ServiceRelocationStatus.SCHEDULED,
  ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED,
  ServiceRelocationStatus.FAILED,
];

const processableRelocationStatuses: ServiceRelocationStatus[] = [
  ServiceRelocationStatus.CONFIRMED,
  ServiceRelocationStatus.SCHEDULED,
  ServiceRelocationStatus.PROVISIONING,
];

const reschedulableRelocationStatuses: ServiceRelocationStatus[] = [
  ServiceRelocationStatus.AWAITING_CONFIRMATION,
  ServiceRelocationStatus.CONFIRMED,
  ServiceRelocationStatus.SCHEDULED,
  ServiceRelocationStatus.FAILED,
  ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED,
];

const relocationInclude = {
  customer: { select: { id: true, userId: true, firstName: true, lastName: true, email: true } },
  subscription: { select: { id: true, status: true, currentServiceAddressId: true } },
  oldServiceAddress: true,
  newServiceAddress: true,
  currentPlan: true,
  requestedPlan: true,
  requestedBy: { select: { id: true, displayName: true, email: true } },
  cancelledBy: { select: { id: true, displayName: true, email: true } },
} satisfies Prisma.ServiceRelocationInclude;

type RelocationRecord = Prisma.ServiceRelocationGetPayload<{ include: typeof relocationInclude }>;

@Injectable()
export class RelocationsService {
  private readonly logger = new Logger(RelocationsService.name);
  private readonly maxProvisioningAttempts: number;
  private readonly maxDisconnectionAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly coverage: CoverageService,
    private readonly provider: ServiceRelocationProvider,
    private readonly notifications: NotificationService,
    @Optional() config?: ConfigService<AppConfig, true>,
  ) {
    const relocation = config?.get('relocation', { infer: true });
    this.maxProvisioningAttempts = relocation?.maxProvisioningAttempts ?? 3;
    this.maxDisconnectionAttempts = relocation?.maxDisconnectionAttempts ?? 3;
  }

  async qualify(subscriptionId: string, selectionToken: string, actor: AuthenticatedUser) {
    const subscription = await this.loadEligibleSubscription(subscriptionId, actor);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'ADDRESS_QUALIFICATION_STARTED',
        entityType: 'Subscription',
        entityId: subscription.id,
        metadata: { workflow: 'SERVICE_RELOCATION' },
      },
    });

    const result = await this.coverage.check(selectionToken, subscription.customerId);
    const currentPlanCompatible = result.plans.some((plan) => plan.id === subscription.planId);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: result.available ? 'ADDRESS_QUALIFIED' : 'ADDRESS_NOT_SERVICEABLE',
        entityType: 'Subscription',
        entityId: subscription.id,
        metadata: {
          workflow: 'SERVICE_RELOCATION',
          resultStatus: result.status,
          technology: result.qualification.technology,
          currentPlanCompatible,
        },
      },
    });
    return { ...result, currentPlanCompatible, currentPlanId: subscription.planId };
  }

  async create(subscriptionId: string, input: CreateRelocationDto, actor: AuthenticatedUser) {
    const requestedMoveDate = this.parseDate(input.requestedMoveDate, 'Requested move date');
    const requestedOldServiceDisconnectionDate = input.requestedOldServiceDisconnectionDate
      ? this.parseDate(input.requestedOldServiceDisconnectionDate, 'Old service disconnection date')
      : null;
    this.assertDates(requestedMoveDate, requestedOldServiceDisconnectionDate);
    await this.loadEligibleSubscription(subscriptionId, actor);
    const qualification = await this.coverage.consumeQualificationForPlan(
      input.qualificationToken,
      input.requestedPlanId,
    );

    let relocation: RelocationRecord;
    try {
      relocation = await this.prisma.$transaction(
        async (transaction) => {
          await this.lockSubscription(transaction, subscriptionId);
          const subscription = await this.findEligibleSubscription(
            transaction,
            subscriptionId,
            actor,
          );
          await this.assertNoConflicts(transaction, subscriptionId);
          const requestedPlan = await transaction.internetPlan.findUnique({
            where: { id: input.requestedPlanId },
          });
          if (!requestedPlan?.isActive || !requestedPlan.isPublic || !requestedPlan.isAvailable) {
            throw new BadRequestException('The selected relocation plan is not available.');
          }
          const oldServiceAddress = await this.ensureCurrentServiceAddress(
            transaction,
            subscription,
          );
          const newServiceAddress = await transaction.serviceAddress.create({
            data: this.serviceAddressData(
              subscription.customerId,
              qualification.address,
              qualification,
            ),
          });
          const created = await transaction.serviceRelocation.create({
            data: {
              customerId: subscription.customerId,
              subscriptionId,
              oldServiceAddressId: oldServiceAddress.id,
              newServiceAddressId: newServiceAddress.id,
              currentPlanId: subscription.planId,
              requestedPlanId: requestedPlan.id,
              requestedMoveDate,
              requestedOldServiceDisconnectionDate,
              qualificationStatus: CoverageResultStatus.AVAILABLE,
              qualification: {
                technology: qualification.technology,
                maximumSpeedMbps: qualification.maximumSpeedMbps,
                checkedAt: qualification.checkedAt,
                source: 'DATABASE_ESTIMATE',
                compatiblePlanIds: qualification.compatiblePlanIds,
              },
              externalLocationId: qualification.address.providerAddressId,
              oldTechnology: oldServiceAddress.technology,
              newTechnology: qualification.technology,
              providerName: this.provider.name,
              providerIdempotencyKey: `relocation-provision:${subscriptionId}:${newServiceAddress.id}`,
              requestedByUserId: actor.id,
            },
            include: relocationInclude,
          });
          await transaction.auditLog.createMany({
            data: [
              {
                actorUserId: actor.id,
                action: 'ADDRESS_QUALIFIED',
                entityType: 'ServiceRelocation',
                entityId: created.id,
                metadata: {
                  actorRole: actor.role,
                  resultStatus: CoverageResultStatus.AVAILABLE,
                  technology: qualification.technology,
                  maximumSpeedMbps: qualification.maximumSpeedMbps,
                },
              },
              {
                actorUserId: actor.id,
                action: 'PLAN_COMPATIBILITY_CHECKED',
                entityType: 'ServiceRelocation',
                entityId: created.id,
                metadata: {
                  actorRole: actor.role,
                  currentPlanId: subscription.planId,
                  requestedPlanId: requestedPlan.id,
                  currentPlanCompatible: qualification.compatiblePlanIds.includes(
                    subscription.planId,
                  ),
                },
              },
              {
                actorUserId: actor.id,
                action: 'RELOCATION_REQUESTED',
                entityType: 'ServiceRelocation',
                entityId: created.id,
                metadata: {
                  actorRole: actor.role,
                  subscriptionId,
                  requestedMoveDate: requestedMoveDate.toISOString(),
                },
              },
            ],
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An active relocation already exists for this subscription.');
      }
      throw error;
    }

    await this.notify('REQUESTED', relocation);
    return this.toResponse(relocation);
  }

  async current(subscriptionId: string, actor: AuthenticatedUser) {
    await this.assertSubscriptionAccess(subscriptionId, actor);
    const relocation = await this.prisma.serviceRelocation.findFirst({
      where: { subscriptionId },
      include: relocationInclude,
      orderBy: { createdAt: 'desc' },
    });
    return relocation ? this.toResponse(relocation) : null;
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const relocation = await this.prisma.serviceRelocation.findFirst({
      where: actor.role === Role.CUSTOMER ? { id, customer: { userId: actor.id } } : { id },
      include: relocationInclude,
    });
    if (!relocation) throw new NotFoundException('Relocation request not found.');
    const response = this.toResponse(relocation);
    if (actor.role === Role.CUSTOMER) return response;
    const [auditHistory, notes, billing, escalation] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where: { entityType: 'ServiceRelocation', entityId: id },
        select: {
          id: true,
          action: true,
          metadata: true,
          createdAt: true,
          actor: { select: { id: true, displayName: true, email: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.serviceRelocationNote.findMany({
        where: { relocationId: id },
        select: {
          id: true,
          body: true,
          authorRole: true,
          createdAt: true,
          author: { select: { id: true, displayName: true, email: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.invoice.findFirst({
        where: { subscriptionId: relocation.subscriptionId },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          totalCents: true,
          currency: true,
          payments: {
            select: { id: true, status: true, provider: true, amountCents: true, paidAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { issueDate: 'desc' },
      }),
      this.prisma.internalRequest.findFirst({
        where: {
          serviceRelocationId: id,
          currentLevel: InternalRequestLevel.SUPER_ADMIN,
          status: { notIn: [InternalRequestStatus.RESOLVED, InternalRequestStatus.CLOSED] },
        },
        select: {
          id: true,
          requestNumber: true,
          status: true,
          priority: true,
          currentLevel: true,
          createdAt: true,
          escalatedAt: true,
          requestedBy: { select: { id: true, displayName: true, email: true } },
          superAdminAssignedTo: { select: { id: true, displayName: true, email: true } },
          events: {
            where: { eventType: InternalRequestEventType.ESCALATED },
            select: { comment: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      ...response,
      providerName: relocation.providerName,
      providerReference: relocation.providerProvisioningId,
      disconnectionProviderReference: relocation.providerDisconnectionId,
      notes,
      auditHistory,
      billing,
      escalation,
      capabilities: this.internalCapabilities(relocation, actor),
    };
  }

  async list(query: RelocationQueryDto) {
    const search = query.search?.trim();
    const requestedFrom = query.requestedFrom
      ? this.parseDate(query.requestedFrom, 'Requested from')
      : undefined;
    const requestedTo = query.requestedTo
      ? this.endOfUtcDay(this.parseDate(query.requestedTo, 'Requested to'))
      : undefined;
    const createdFrom = query.createdFrom
      ? this.parseDate(query.createdFrom, 'Created from')
      : undefined;
    const createdTo = query.createdTo
      ? this.endOfUtcDay(this.parseDate(query.createdTo, 'Created to'))
      : undefined;
    const where: Prisma.ServiceRelocationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.provisioningStatus ? { provisioningStatus: query.provisioningStatus } : {}),
      ...(query.disconnectionStatus
        ? { oldServiceDisconnectionStatus: query.disconnectionStatus }
        : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
      ...(requestedFrom || requestedTo
        ? { requestedMoveDate: { gte: requestedFrom, lte: requestedTo } }
        : {}),
      ...(createdFrom || createdTo ? { createdAt: { gte: createdFrom, lte: createdTo } } : {}),
      ...(search
        ? {
            OR: [
              ...(this.isUuid(search) ? [{ id: search }] : []),
              { customer: { firstName: { contains: search, mode: 'insensitive' } } },
              { customer: { lastName: { contains: search, mode: 'insensitive' } } },
              { customer: { email: { contains: search, mode: 'insensitive' } } },
              { newServiceAddress: { addressLine1: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.serviceRelocation.findMany({
        where,
        include: relocationInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.serviceRelocation.count({ where }),
    ]);
    return {
      data: data.map((item) => this.toResponse(item)),
      meta: buildPaginationMeta(query, total),
    };
  }

  async confirm(id: string, actor: AuthenticatedUser) {
    const confirmedAt = new Date();
    const relocation = await this.prisma.$transaction(async (transaction) => {
      const existing = await this.findForActor(transaction, id, actor);
      if (existing.status !== ServiceRelocationStatus.AWAITING_CONFIRMATION) {
        throw new ConflictException('This relocation is no longer awaiting confirmation.');
      }
      await this.assertNoOperationalConflict(transaction, existing.subscriptionId, id);
      const scheduled = existing.requestedMoveDate > this.todayUtc();
      const updated = await transaction.serviceRelocation.update({
        where: { id },
        data: {
          status: scheduled ? ServiceRelocationStatus.SCHEDULED : ServiceRelocationStatus.CONFIRMED,
          confirmedAt,
          scheduledAt: scheduled ? confirmedAt : null,
          version: { increment: 1 },
        },
        include: relocationInclude,
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'RELOCATION_CONFIRMED',
          entityType: 'ServiceRelocation',
          entityId: id,
          metadata: { scheduled },
        },
      });
      return updated;
    });
    await this.notify(
      relocation.status === ServiceRelocationStatus.SCHEDULED ? 'SCHEDULED' : 'CONFIRMED',
      relocation,
    );
    if (relocation.status !== ServiceRelocationStatus.SCHEDULED) {
      await this.processProvisioning(id);
    }
    return this.findOne(id, actor);
  }

  async cancel(id: string, actor: AuthenticatedUser, reason?: string) {
    if (actor.role !== Role.CUSTOMER && !reason?.trim()) {
      throw new BadRequestException('A cancellation reason is required for an internal action.');
    }
    const cancelledAt = new Date();
    const relocation = await this.prisma.$transaction(async (transaction) => {
      const existing = await this.findForActor(transaction, id, actor);
      if (
        !cancellableRelocationStatuses.includes(existing.status) ||
        Boolean(existing.newServiceActivatedAt)
      ) {
        throw new ConflictException(
          'This relocation has reached provisioning and can no longer be cancelled online.',
        );
      }
      const updated = await transaction.serviceRelocation.update({
        where: { id },
        data: {
          status: ServiceRelocationStatus.CANCELLED,
          cancelledAt,
          cancelledByUserId: actor.id,
          version: { increment: 1 },
        },
        include: relocationInclude,
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'RELOCATION_CANCELLED',
          entityType: 'ServiceRelocation',
          entityId: id,
          metadata: {
            subscriptionPreserved: true,
            reason: reason?.trim() ?? null,
            actorRole: actor.role,
          },
        },
      });
      return updated;
    });
    return this.toResponse(relocation);
  }

  async retry(id: string, actor: AuthenticatedUser) {
    return this.retryProvisioning(id, actor, false);
  }

  async retryProvisioning(
    id: string,
    actor: AuthenticatedUser,
    force = false,
    ignoreSchedule = false,
  ) {
    const relocation = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.serviceRelocation.findUnique({
        where: { id },
        include: relocationInclude,
      });
      if (!existing) throw new NotFoundException('Relocation request not found.');
      if (existing.status !== ServiceRelocationStatus.FAILED) {
        throw new ConflictException('Only a failed relocation can be retried.');
      }
      if (!force && existing.attemptCount >= this.maxProvisioningAttempts) {
        throw new ConflictException(
          'The normal provisioning retry limit has been reached. Escalate this relocation for Super Admin review.',
        );
      }
      await this.assertNoOperationalConflict(transaction, existing.subscriptionId, id);
      const updated = await transaction.serviceRelocation.update({
        where: { id },
        data: {
          status: ServiceRelocationStatus.CONFIRMED,
          provisioningStatus: null,
          providerProvisioningId: null,
          providerPayload: Prisma.DbNull,
          failureReason: null,
          version: { increment: 1 },
        },
        include: relocationInclude,
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'RELOCATION_PROVISIONING_RETRY_REQUESTED',
          entityType: 'ServiceRelocation',
          entityId: id,
          metadata: { actorRole: actor.role, force },
        },
      });
      return updated;
    });
    await this.processProvisioning(relocation.id, ignoreSchedule);
    return this.findOne(id, actor);
  }

  async addNote(id: string, body: string, actor: AuthenticatedUser) {
    await this.requireInternalRelocation(id);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.serviceRelocationNote.create({
        data: {
          relocationId: id,
          authorUserId: actor.id,
          authorRole: actor.role,
          body: body.trim(),
        },
      });
      await this.audit(transaction, id, actor, 'RELOCATION_INTERNAL_NOTE_ADDED', {
        noteLength: body.trim().length,
      });
    });
    return this.findOne(id, actor);
  }

  async reschedule(id: string, input: RescheduleRelocationDto, actor: AuthenticatedUser) {
    const requestedMoveDate = this.parseDate(input.requestedMoveDate, 'Requested move date');
    const requestedOldServiceDisconnectionDate = input.requestedOldServiceDisconnectionDate
      ? this.parseDate(input.requestedOldServiceDisconnectionDate, 'Disconnection date')
      : null;
    this.assertDates(requestedMoveDate, requestedOldServiceDisconnectionDate);
    await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.serviceRelocation.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Relocation request not found.');
      if (
        existing.newServiceActivatedAt ||
        !reschedulableRelocationStatuses.includes(existing.status)
      ) {
        throw new ConflictException('A relocation cannot be rescheduled after activation begins.');
      }
      const nextStatus =
        existing.confirmedAt && requestedMoveDate > this.todayUtc()
          ? ServiceRelocationStatus.SCHEDULED
          : existing.status === ServiceRelocationStatus.SCHEDULED
            ? ServiceRelocationStatus.CONFIRMED
            : existing.status;
      await transaction.serviceRelocation.update({
        where: { id },
        data: {
          requestedMoveDate,
          requestedOldServiceDisconnectionDate,
          status: nextStatus,
          scheduledAt: nextStatus === ServiceRelocationStatus.SCHEDULED ? new Date() : null,
          version: { increment: 1 },
        },
      });
      await this.audit(transaction, id, actor, 'RELOCATION_RESCHEDULED', {
        previousMoveDate: existing.requestedMoveDate.toISOString(),
        requestedMoveDate: requestedMoveDate.toISOString(),
        requestedOldServiceDisconnectionDate:
          requestedOldServiceDisconnectionDate?.toISOString() ?? null,
      });
    });
    return this.findOne(id, actor);
  }

  async retryQualification(id: string, actor: AuthenticatedUser) {
    const existing = await this.prisma.serviceRelocation.findUnique({
      where: { id },
      include: { newServiceAddress: true },
    });
    if (!existing) throw new NotFoundException('Relocation request not found.');
    if (
      existing.newServiceActivatedAt ||
      !reschedulableRelocationStatuses.includes(existing.status)
    ) {
      throw new ConflictException(
        "Qualification cannot be retried in the relocation's current state.",
      );
    }
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'ADDRESS_QUALIFICATION_RETRY_STARTED',
        entityType: 'ServiceRelocation',
        entityId: id,
        metadata: { actorRole: actor.role },
      },
    });
    const address = existing.newServiceAddress;
    const decision = await this.coverage.requalifyTrustedAddress(
      {
        provider: (address.provider ?? 'geoapify') as 'geoapify',
        providerAddressId: address.providerAddressId ?? address.id,
        formattedAddress: this.formatAddress(address),
        unit: address.addressLine2,
        houseNumber: null,
        street: address.addressLine1,
        suburb: address.suburb,
        city: address.suburb,
        state: address.state,
        stateCode: address.state,
        postcode: address.postcode,
        countryCode: address.countryCode,
        latitude: Number(address.latitude ?? 0),
        longitude: Number(address.longitude ?? 0),
      },
      existing.customerId,
    );
    await this.prisma.$transaction(async (transaction) => {
      const compatiblePlanIds = decision.plans.map((plan) => plan.id);
      const status = decision.available
        ? existing.status === ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED
          ? (existing.statusBeforeManualReview ?? ServiceRelocationStatus.FAILED)
          : existing.status
        : ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED;
      await transaction.serviceAddress.update({
        where: { id: existing.newServiceAddressId },
        data: {
          technology: decision.qualification.technology,
          maximumSpeedMbps: decision.qualification.maximumSpeedMbps,
          qualification: {
            checkedAt: decision.qualification.checkedAt,
            compatiblePlanIds,
            source: decision.qualification.source,
          },
        },
      });
      await transaction.serviceRelocation.update({
        where: { id },
        data: {
          qualificationStatus: decision.status,
          qualification: decision as unknown as Prisma.InputJsonValue,
          newTechnology: decision.qualification.technology,
          status,
          statusBeforeManualReview: decision.available
            ? null
            : existing.status === ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED
              ? (existing.statusBeforeManualReview ?? ServiceRelocationStatus.FAILED)
              : existing.status,
          failureReason: decision.available ? null : decision.message,
          version: { increment: 1 },
        },
      });
      await this.audit(
        transaction,
        id,
        actor,
        decision.available ? 'ADDRESS_QUALIFIED' : 'ADDRESS_NOT_SERVICEABLE',
        {
          resultStatus: decision.status,
          technology: decision.qualification.technology,
          currentPlanCompatible: compatiblePlanIds.includes(existing.currentPlanId),
        },
      );
    });
    return this.findOne(id, actor);
  }

  async configureDemoOutcome(
    id: string,
    input: DemoRelocationOutcomeDto,
    actor: AuthenticatedUser,
  ) {
    if (!this.provider.simulated) {
      throw new ConflictException('Demo outcomes are unavailable for a live provider.');
    }
    const existing = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.serviceRelocation.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Relocation request not found.');
      if (
        (
          [
            ServiceRelocationStatus.COMPLETED,
            ServiceRelocationStatus.CANCELLED,
            ServiceRelocationStatus.FORCE_CLOSED,
          ] as ServiceRelocationStatus[]
        ).includes(existing.status)
      ) {
        throw new ConflictException(
          'A demo outcome cannot be configured for a terminal relocation.',
        );
      }
      if (input.processNow && input.operation === 'PROVISIONING') {
        const canStart = processableRelocationStatuses.includes(existing.status);
        const canRetry =
          existing.status === ServiceRelocationStatus.FAILED &&
          existing.attemptCount < this.maxProvisioningAttempts;
        if (!canStart && !canRetry) {
          throw new ConflictException(
            existing.status === ServiceRelocationStatus.AWAITING_CONFIRMATION
              ? 'Confirm the relocation before simulating provisioning.'
              : 'Provisioning cannot be simulated in the relocation\'s current state.',
          );
        }
      }
      if (input.processNow && input.operation === 'DISCONNECTION') {
        const canDisconnect =
          Boolean(existing.newServiceActivatedAt) &&
          existing.provisioningStatus === ServiceProvisioningStatus.COMPLETED &&
          existing.status === ServiceRelocationStatus.PARTIALLY_COMPLETED &&
          existing.oldServiceDisconnectionStatus !== CancellationProviderStatus.COMPLETED;
        const retryLimitReached =
          existing.oldServiceDisconnectionStatus === CancellationProviderStatus.FAILED &&
          existing.disconnectionAttemptCount >= this.maxDisconnectionAttempts;
        if (!canDisconnect || retryLimitReached) {
          throw new ConflictException(
            !existing.newServiceActivatedAt
              ? 'Activate the new service before simulating old-service disconnection.'
              : 'Old-service disconnection cannot be simulated in the relocation\'s current state.',
          );
        }
      }
      await transaction.serviceRelocation.update({
        where: { id },
        data:
          input.operation === 'PROVISIONING'
            ? { nextMockProvisioningOutcome: input.outcome }
            : { nextMockDisconnectionOutcome: input.outcome },
      });
      await this.audit(transaction, id, actor, 'RELOCATION_DEMO_OUTCOME_CONFIGURED', {
        operation: input.operation,
        outcome: input.outcome,
      });
      return existing;
    });
    if (input.processNow) {
      if (input.operation === 'PROVISIONING') {
        if (existing.status === ServiceRelocationStatus.FAILED) {
          return this.retryProvisioning(id, actor, false, true);
        }
        await this.processProvisioning(id, true);
      } else {
        if (existing.oldServiceDisconnectionStatus === CancellationProviderStatus.FAILED) {
          return this.retryDisconnection(id, actor, false, true);
        }
        await this.processDisconnection(id, true);
      }
    }
    return this.findOne(id, actor);
  }

  async escalate(id: string, input: EscalateRelocationDto, actor: AuthenticatedUser) {
    if (actor.role !== Role.ADMIN) {
      throw new ForbiddenException('Only an administrator can escalate a relocation.');
    }
    const created = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.serviceRelocation.findUnique({
        where: { id },
        include: { customer: true, requestedPlan: true },
      });
      if (!existing) throw new NotFoundException('Relocation request not found.');
      if (
        (
          [
            ServiceRelocationStatus.COMPLETED,
            ServiceRelocationStatus.CANCELLED,
            ServiceRelocationStatus.FORCE_CLOSED,
          ] as ServiceRelocationStatus[]
        ).includes(existing.status)
      ) {
        throw new ConflictException('A terminal relocation cannot be escalated.');
      }
      const open = await transaction.internalRequest.findFirst({
        where: {
          serviceRelocationId: id,
          status: { notIn: [InternalRequestStatus.RESOLVED, InternalRequestStatus.CLOSED] },
        },
        select: { requestNumber: true },
      });
      if (open)
        throw new ConflictException(
          `This relocation is already escalated (${open.requestNumber}).`,
        );
      const now = new Date();
      const year = now.getUTCFullYear();
      const sequence = await transaction.internalRequestSequence.upsert({
        where: { year },
        create: { year, value: 1 },
        update: { value: { increment: 1 } },
        select: { value: true },
      });
      const request = await transaction.internalRequest.create({
        data: {
          requestNumber: `IR-${year}-${String(sequence.value).padStart(5, '0')}`,
          requestedByUserId: actor.id,
          requesterRole: actor.role,
          targetRole: Role.ADMIN,
          currentLevel: InternalRequestLevel.SUPER_ADMIN,
          type: InternalRequestType.RELOCATION_REVIEW,
          title: `Relocation review for ${existing.customer.firstName} ${existing.customer.lastName}`,
          description: input.reason,
          priority: input.priority,
          status: InternalRequestStatus.PENDING,
          customerId: existing.customerId,
          subscriptionId: existing.subscriptionId,
          serviceRelocationId: id,
          escalatedByUserId: actor.id,
          escalatedAt: now,
        },
      });
      await transaction.internalRequestEvent.createMany({
        data: [
          {
            internalRequestId: request.id,
            actorUserId: actor.id,
            actorRole: actor.role,
            eventType: InternalRequestEventType.CREATED,
            toLevel: InternalRequestLevel.SUPER_ADMIN,
          },
          {
            internalRequestId: request.id,
            actorUserId: actor.id,
            actorRole: actor.role,
            eventType: InternalRequestEventType.ESCALATED,
            fromLevel: InternalRequestLevel.ADMIN,
            toLevel: InternalRequestLevel.SUPER_ADMIN,
            comment: input.reason,
          },
        ],
      });
      await transaction.serviceRelocation.update({
        where: { id },
        data: {
          statusBeforeManualReview:
            existing.status === ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED
              ? (existing.statusBeforeManualReview ?? ServiceRelocationStatus.FAILED)
              : existing.status,
          status: ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED,
          version: { increment: 1 },
        },
      });
      await this.audit(transaction, id, actor, 'RELOCATION_ESCALATED', {
        reason: input.reason,
        previousStatus: existing.status,
        newStatus: ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED,
        internalRequestNumber: request.requestNumber,
      });
      return request;
    });
    try {
      const recipients = await this.prisma.user.findMany({
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
          this.notifications.sendInternalRequestSuperAdminUpdate({
            event: 'ESCALATED',
            requestNumber: created.requestNumber,
            superAdminEmail: recipient.email,
            priority: created.priority,
          }),
        ),
      );
    } catch (error: unknown) {
      this.logger.warn(
        JSON.stringify({
          event: 'relocation_escalation_notification_failed',
          relocationId: id,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
    return { ...(await this.findOne(id, actor)), escalationRequestNumber: created.requestNumber };
  }

  async resolveEscalation(id: string, reason: string, actor: AuthenticatedUser) {
    if (actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only a Super Admin can resolve an escalation.');
    }
    await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.serviceRelocation.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Relocation request not found.');
      const request = await transaction.internalRequest.findFirst({
        where: {
          serviceRelocationId: id,
          currentLevel: InternalRequestLevel.SUPER_ADMIN,
          status: { notIn: [InternalRequestStatus.RESOLVED, InternalRequestStatus.CLOSED] },
        },
      });
      if (!request) throw new ConflictException('This relocation has no open escalation.');
      const resumedStatus = existing.newServiceActivatedAt
        ? ServiceRelocationStatus.PARTIALLY_COMPLETED
        : (existing.statusBeforeManualReview ?? ServiceRelocationStatus.FAILED);
      await transaction.internalRequest.update({
        where: { id: request.id },
        data: {
          status: InternalRequestStatus.RESOLVED,
          reviewedByUserId: actor.id,
          reviewedAt: new Date(),
          resolvedAt: new Date(),
        },
      });
      await transaction.internalRequestEvent.create({
        data: {
          internalRequestId: request.id,
          actorUserId: actor.id,
          actorRole: actor.role,
          eventType: InternalRequestEventType.RESOLVED,
          fromLevel: InternalRequestLevel.SUPER_ADMIN,
          toLevel: InternalRequestLevel.SUPER_ADMIN,
          comment: reason,
        },
      });
      await transaction.serviceRelocation.update({
        where: { id },
        data: { status: resumedStatus, statusBeforeManualReview: null, version: { increment: 1 } },
      });
      await this.audit(transaction, id, actor, 'RELOCATION_ESCALATION_RESOLVED', {
        reason,
        previousStatus: existing.status,
        newStatus: resumedStatus,
        internalRequestNumber: request.requestNumber,
      });
    });
    return this.findOne(id, actor);
  }

  async override(id: string, input: OverrideRelocationDto, actor: AuthenticatedUser) {
    if (actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only a Super Admin can override a relocation.');
    }
    if (input.reason.trim().length < 10) {
      throw new BadRequestException('A meaningful override reason is required.');
    }
    const before = await this.requireInternalRelocation(id);
    if (input.action === RelocationOverrideAction.MARK_NEW_SERVICE_ACTIVE) {
      if (before.newServiceActivatedAt) {
        throw new ConflictException('The new service is already active.');
      }
      await this.prisma.serviceRelocation.update({
        where: { id },
        data: {
          status: ServiceRelocationStatus.PROVISIONING,
          provisioningStatus: ServiceProvisioningStatus.PENDING,
        },
      });
      await this.applyProviderResult(id, {
        providerReference: before.providerProvisioningId ?? `MANUAL-${id}`,
        status: ServiceProvisioningStatus.COMPLETED,
        payload: { manualOverride: true },
      });
    } else if (input.action === RelocationOverrideAction.MARK_OLD_SERVICE_DISCONNECTED) {
      if (!before.newServiceActivatedAt) {
        throw new ConflictException(
          'The new service must be active before the old service is closed.',
        );
      }
      if (before.oldServiceDisconnectedAt) {
        throw new ConflictException('The old service is already disconnected.');
      }
      await this.completeOldServiceDisconnection(id);
    } else if (input.action === RelocationOverrideAction.FORCE_RETRY_PROVISIONING) {
      if (before.newServiceActivatedAt) {
        throw new ConflictException(
          'Provisioning cannot be retried after the new service is active.',
        );
      }
      await this.prisma.serviceRelocation.update({
        where: { id },
        data: { status: ServiceRelocationStatus.FAILED },
      });
      await this.retryProvisioning(id, actor, true);
    } else if (input.action === RelocationOverrideAction.FORCE_RETRY_DISCONNECTION) {
      await this.retryDisconnection(id, actor, true);
    } else {
      await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.serviceRelocation.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Relocation request not found.');
        let status = current.status;
        if (input.action === RelocationOverrideAction.FORCE_CLOSE) {
          status = ServiceRelocationStatus.FORCE_CLOSED;
        } else if (input.action === RelocationOverrideAction.REOPEN) {
          if (
            !(
              [
                ServiceRelocationStatus.FAILED,
                ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED,
                ServiceRelocationStatus.FORCE_CLOSED,
              ] as ServiceRelocationStatus[]
            ).includes(current.status)
          ) {
            throw new ConflictException(
              'Only a failed, manual-review, or force-closed relocation can be reopened.',
            );
          }
          status = current.newServiceActivatedAt
            ? ServiceRelocationStatus.PARTIALLY_COMPLETED
            : ServiceRelocationStatus.FAILED;
        } else if (input.action === RelocationOverrideAction.SET_STATUS) {
          if (current.newServiceActivatedAt) {
            throw new ConflictException(
              'Use new-service and old-service manual actions after activation has occurred.',
            );
          }
          const allowed: ServiceRelocationStatus[] = [
            ServiceRelocationStatus.AWAITING_CONFIRMATION,
            ServiceRelocationStatus.CONFIRMED,
            ServiceRelocationStatus.SCHEDULED,
            ServiceRelocationStatus.FAILED,
            ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED,
          ];
          if (!input.targetStatus || !allowed.includes(input.targetStatus)) {
            throw new BadRequestException('The requested workflow status cannot be set directly.');
          }
          status = input.targetStatus;
        }
        await transaction.serviceRelocation.update({
          where: { id },
          data: { status, version: { increment: 1 } },
        });
      });
    }
    const after = await this.prisma.serviceRelocation.findUniqueOrThrow({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'RELOCATION_SUPER_ADMIN_OVERRIDE',
        entityType: 'ServiceRelocation',
        entityId: id,
        metadata: {
          actorRole: actor.role,
          overrideAction: input.action,
          previousStatus: before.status,
          newStatus: after.status,
          previousProvisioningStatus: before.provisioningStatus,
          newProvisioningStatus: after.provisioningStatus,
          previousDisconnectionStatus: before.oldServiceDisconnectionStatus,
          newDisconnectionStatus: after.oldServiceDisconnectionStatus,
          reason: input.reason,
        },
      },
    });
    return this.findOne(id, actor);
  }

  async reconcileDue(limit: number): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.serviceRelocation.findMany({
      where: {
        OR: [
          {
            status: ServiceRelocationStatus.SCHEDULED,
            provisioningStatus: null,
            requestedMoveDate: { lte: now },
          },
          {
            status: {
              in: [ServiceRelocationStatus.SCHEDULED, ServiceRelocationStatus.PARTIALLY_COMPLETED],
            },
            provisioningStatus: ServiceProvisioningStatus.COMPLETED,
            oldServiceDisconnectionStatus: CancellationProviderStatus.PENDING,
            OR: [
              { requestedOldServiceDisconnectionDate: null },
              { requestedOldServiceDisconnectionDate: { lte: now } },
            ],
          },
          {
            status: ServiceRelocationStatus.PROVISIONING,
            provisioningStatus: ServiceProvisioningStatus.PENDING,
          },
        ],
      },
      select: { id: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    for (const candidate of candidates) {
      try {
        await this.processProvisioning(candidate.id);
        await this.processDisconnection(candidate.id);
      } catch (error: unknown) {
        this.logger.error(
          JSON.stringify({
            event: 'relocation_reconciliation_failed',
            relocationId: candidate.id,
            error: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
      }
    }
    return candidates.length;
  }

  async processProvisioning(id: string, ignoreSchedule = false): Promise<void> {
    const claimed = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.serviceRelocation.findUnique({ where: { id } });
      if (!existing || existing.status === ServiceRelocationStatus.COMPLETED) return null;
      if (!processableRelocationStatuses.includes(existing.status)) {
        return null;
      }
      if (
        !ignoreSchedule &&
        existing.status === ServiceRelocationStatus.SCHEDULED &&
        existing.requestedMoveDate > this.todayUtc()
      ) {
        return null;
      }
      await this.lockSubscription(transaction, existing.subscriptionId);
      const now = new Date();
      const updated = await transaction.serviceRelocation.update({
        where: { id },
        data: {
          status: ServiceRelocationStatus.PROVISIONING,
          provisioningStatus: ServiceProvisioningStatus.PENDING,
          provisioningStartedAt: existing.provisioningStartedAt ?? now,
          lastAttemptAt: now,
          attemptCount: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (!existing.provisioningStartedAt) {
        await transaction.auditLog.create({
          data: {
            action: 'PROVISIONING_STARTED',
            entityType: 'ServiceRelocation',
            entityId: id,
            metadata: { provider: this.provider.name },
          },
        });
      }
      return updated;
    });
    if (!claimed) return;

    let result: RelocationProvisioningResult;
    try {
      result = claimed.providerProvisioningId
        ? await this.provider.getProvisioningStatus({
            providerReference: claimed.providerProvisioningId,
            relocationId: claimed.id,
            pollCount: Math.max(0, claimed.attemptCount - 1),
            mockOutcome: claimed.nextMockProvisioningOutcome,
          })
        : await this.provider.requestProvisioning({
            relocationId: claimed.id,
            subscriptionId: claimed.subscriptionId,
            idempotencyKey: claimed.providerIdempotencyKey,
            requestedMoveDate: claimed.requestedMoveDate,
            oldServiceAddressId: claimed.oldServiceAddressId,
            newServiceAddressId: claimed.newServiceAddressId,
            mockOutcome: claimed.nextMockProvisioningOutcome,
          });
    } catch {
      result = {
        providerReference: claimed.providerProvisioningId ?? `UNAVAILABLE-${claimed.id}`,
        status: ServiceProvisioningStatus.FAILED,
        payload: { providerUnavailable: true },
        failureReason: 'The relocation provisioning provider is temporarily unavailable.',
      };
    }
    await this.applyProviderResult(claimed.id, result);
  }

  private async applyProviderResult(id: string, result: RelocationProvisioningResult) {
    if (result.status === ServiceProvisioningStatus.PENDING) {
      await this.prisma.serviceRelocation.updateMany({
        where: { id, status: ServiceRelocationStatus.PROVISIONING },
        data: {
          provisioningStatus: result.status,
          providerProvisioningId: result.providerReference,
          providerPayload: result.payload as Prisma.InputJsonValue,
        },
      });
      return;
    }
    if (result.status === ServiceProvisioningStatus.FAILED) {
      const failed = await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.serviceRelocation.findUnique({ where: { id } });
        if (!current || current.status === ServiceRelocationStatus.COMPLETED) return null;
        const updated = await transaction.serviceRelocation.update({
          where: { id },
          data: {
            status: ServiceRelocationStatus.FAILED,
            provisioningStatus: ServiceProvisioningStatus.FAILED,
            providerProvisioningId: result.providerReference,
            providerPayload: result.payload as Prisma.InputJsonValue,
            failureReason: result.failureReason ?? 'Relocation provisioning failed.',
            nextMockProvisioningOutcome: null,
            version: { increment: 1 },
          },
          include: relocationInclude,
        });
        await transaction.auditLog.create({
          data: {
            action: 'PROVISIONING_FAILED',
            entityType: 'ServiceRelocation',
            entityId: id,
            metadata: {
              provider: this.provider.name,
              failureReason: updated.failureReason,
              subscriptionPreserved: true,
            },
          },
        });
        return updated;
      });
      if (failed) await this.notify('FAILED', failed);
      return;
    }

    const completedAt = new Date();
    const completed = await this.prisma.$transaction(
      async (transaction) => {
        const initial = await transaction.serviceRelocation.findUnique({ where: { id } });
        if (!initial) throw new NotFoundException('Relocation request not found.');
        if (
          initial.newServiceActivatedAt ||
          initial.provisioningStatus === ServiceProvisioningStatus.COMPLETED ||
          (
            [
              ServiceRelocationStatus.PARTIALLY_COMPLETED,
              ServiceRelocationStatus.COMPLETED,
            ] as ServiceRelocationStatus[]
          ).includes(initial.status)
        ) {
          return null;
        }
        await this.lockSubscription(transaction, initial.subscriptionId);
        const current = await transaction.serviceRelocation.findUnique({
          where: { id },
          include: relocationInclude,
        });
        if (!current || current.status === ServiceRelocationStatus.COMPLETED) return null;
        if (current.status !== ServiceRelocationStatus.PROVISIONING) return null;
        await transaction.subscription.update({
          where: { id: current.subscriptionId },
          data: {
            currentServiceAddressId: current.newServiceAddressId,
            planId: current.requestedPlanId,
            monthlyCents: current.requestedPlan.monthlyCents,
          },
        });
        await transaction.customerAddress.upsert({
          where: {
            customerId_type: { customerId: current.customerId, type: AddressType.SERVICE },
          },
          create: {
            customerId: current.customerId,
            type: AddressType.SERVICE,
            addressLine1: current.newServiceAddress.addressLine1,
            addressLine2: current.newServiceAddress.addressLine2,
            suburb: current.newServiceAddress.suburb,
            state: current.newServiceAddress.state,
            postcode: current.newServiceAddress.postcode,
          },
          update: {
            addressLine1: current.newServiceAddress.addressLine1,
            addressLine2: current.newServiceAddress.addressLine2,
            suburb: current.newServiceAddress.suburb,
            state: current.newServiceAddress.state,
            postcode: current.newServiceAddress.postcode,
          },
        });
        const updated = await transaction.serviceRelocation.update({
          where: { id },
          data: {
            status: ServiceRelocationStatus.PARTIALLY_COMPLETED,
            provisioningStatus: ServiceProvisioningStatus.COMPLETED,
            oldServiceDisconnectionStatus: CancellationProviderStatus.PENDING,
            providerProvisioningId: result.providerReference,
            providerPayload: result.payload as Prisma.InputJsonValue,
            newServiceActivatedAt: completedAt,
            oldServiceDisconnectedAt: null,
            completedAt: null,
            scheduledAt: current.scheduledAt,
            failureReason: null,
            nextMockProvisioningOutcome: null,
            version: { increment: 1 },
          },
          include: relocationInclude,
        });
        await transaction.auditLog.create({
          data: {
            action: 'NEW_SERVICE_ACTIVATED',
            entityType: 'ServiceRelocation',
            entityId: id,
            metadata: {
              serviceAddressId: current.newServiceAddressId,
              oldServiceDisconnectionStatus: CancellationProviderStatus.PENDING,
            },
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (completed) {
      await this.notify('SCHEDULED', completed);
      if (
        !completed.requestedOldServiceDisconnectionDate ||
        completed.requestedOldServiceDisconnectionDate <= this.todayUtc()
      ) {
        await this.processDisconnection(id);
      }
    }
  }

  async retryDisconnection(
    id: string,
    actor: AuthenticatedUser,
    force = false,
    ignoreSchedule = false,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.serviceRelocation.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Relocation request not found.');
      if (
        !existing.newServiceActivatedAt ||
        existing.provisioningStatus !== ServiceProvisioningStatus.COMPLETED
      ) {
        throw new ConflictException(
          'The new service must be active before disconnection can be retried.',
        );
      }
      if (existing.oldServiceDisconnectionStatus !== CancellationProviderStatus.FAILED) {
        throw new ConflictException('Only a failed old-service disconnection can be retried.');
      }
      if (!force && existing.disconnectionAttemptCount >= this.maxDisconnectionAttempts) {
        throw new ConflictException(
          'The normal disconnection retry limit has been reached. Escalate this relocation for Super Admin review.',
        );
      }
      await transaction.serviceRelocation.update({
        where: { id },
        data: {
          status: ServiceRelocationStatus.PARTIALLY_COMPLETED,
          oldServiceDisconnectionStatus: CancellationProviderStatus.PENDING,
          providerDisconnectionId: null,
          disconnectionProviderPayload: Prisma.DbNull,
          disconnectionFailureReason: null,
          version: { increment: 1 },
        },
      });
      await this.audit(transaction, id, actor, 'OLD_SERVICE_DISCONNECTION_RETRY_REQUESTED', {
        force,
      });
    });
    await this.processDisconnection(id, ignoreSchedule);
    return this.findOne(id, actor);
  }

  async processDisconnection(id: string, ignoreSchedule = false): Promise<void> {
    const claimed = await this.prisma.$transaction(async (transaction) => {
      const initial = await transaction.serviceRelocation.findUnique({ where: { id } });
      if (
        !initial ||
        initial.oldServiceDisconnectionStatus === CancellationProviderStatus.COMPLETED
      ) {
        return null;
      }
      if (
        !initial.newServiceActivatedAt ||
        initial.provisioningStatus !== ServiceProvisioningStatus.COMPLETED ||
        !(
          [
            ServiceRelocationStatus.SCHEDULED,
            ServiceRelocationStatus.PARTIALLY_COMPLETED,
          ] as ServiceRelocationStatus[]
        ).includes(initial.status)
      ) {
        return null;
      }
      if (
        !ignoreSchedule &&
        initial.requestedOldServiceDisconnectionDate &&
        initial.requestedOldServiceDisconnectionDate > this.todayUtc()
      ) {
        return null;
      }
      await this.lockSubscription(transaction, initial.subscriptionId);
      const now = new Date();
      const updated = await transaction.serviceRelocation.update({
        where: { id },
        data: {
          status: ServiceRelocationStatus.PARTIALLY_COMPLETED,
          oldServiceDisconnectionStatus: CancellationProviderStatus.PENDING,
          disconnectionAttemptCount: { increment: 1 },
          lastDisconnectionAttemptAt: now,
          version: { increment: 1 },
        },
      });
      if (initial.disconnectionAttemptCount === 0) {
        await transaction.auditLog.create({
          data: {
            action: 'OLD_SERVICE_DISCONNECTION_REQUESTED',
            entityType: 'ServiceRelocation',
            entityId: id,
            metadata: { provider: this.provider.name },
          },
        });
      }
      return updated;
    });
    if (!claimed) return;

    let result: RelocationDisconnectionResult;
    try {
      result = claimed.providerDisconnectionId
        ? await this.provider.getDisconnectionStatus({
            providerReference: claimed.providerDisconnectionId,
            relocationId: claimed.id,
            pollCount: Math.max(0, claimed.disconnectionAttemptCount - 1),
            mockOutcome: claimed.nextMockDisconnectionOutcome,
          })
        : await this.provider.requestDisconnection({
            relocationId: claimed.id,
            subscriptionId: claimed.subscriptionId,
            idempotencyKey: `${claimed.providerIdempotencyKey}:disconnect`,
            oldServiceAddressId: claimed.oldServiceAddressId,
            mockOutcome: claimed.nextMockDisconnectionOutcome,
          });
    } catch {
      result = {
        providerReference: claimed.providerDisconnectionId ?? `UNAVAILABLE-DISCONNECT-${id}`,
        status: CancellationProviderStatus.FAILED,
        payload: { providerUnavailable: true },
        failureReason: 'The old-service disconnection provider is temporarily unavailable.',
      };
    }

    if (result.status === CancellationProviderStatus.PENDING) {
      await this.prisma.serviceRelocation.updateMany({
        where: {
          id,
          status: ServiceRelocationStatus.PARTIALLY_COMPLETED,
          oldServiceDisconnectionStatus: CancellationProviderStatus.PENDING,
        },
        data: {
          providerDisconnectionId: result.providerReference,
          disconnectionProviderPayload: result.payload as Prisma.InputJsonValue,
        },
      });
      return;
    }
    if (result.status === CancellationProviderStatus.FAILED) {
      await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.serviceRelocation.updateMany({
          where: {
            id,
            oldServiceDisconnectionStatus: CancellationProviderStatus.PENDING,
          },
          data: {
            status: ServiceRelocationStatus.PARTIALLY_COMPLETED,
            oldServiceDisconnectionStatus: CancellationProviderStatus.FAILED,
            providerDisconnectionId: result.providerReference,
            disconnectionProviderPayload: result.payload as Prisma.InputJsonValue,
            disconnectionFailureReason: result.failureReason ?? 'Old-service disconnection failed.',
            nextMockDisconnectionOutcome: null,
            version: { increment: 1 },
          },
        });
        if (updated.count) {
          await transaction.auditLog.create({
            data: {
              action: 'OLD_SERVICE_DISCONNECTION_FAILED',
              entityType: 'ServiceRelocation',
              entityId: id,
              metadata: { failureReason: result.failureReason ?? null },
            },
          });
        }
      });
      return;
    }
    await this.prisma.serviceRelocation.updateMany({
      where: { id, oldServiceDisconnectionStatus: CancellationProviderStatus.PENDING },
      data: {
        providerDisconnectionId: result.providerReference,
        disconnectionProviderPayload: result.payload as Prisma.InputJsonValue,
        disconnectionFailureReason: null,
        nextMockDisconnectionOutcome: null,
      },
    });
    await this.completeOldServiceDisconnection(id);
  }

  private async completeOldServiceDisconnection(id: string) {
    const completedAt = new Date();
    const completed = await this.prisma.$transaction(async (transaction) => {
      const initial = await transaction.serviceRelocation.findUnique({ where: { id } });
      if (!initial) return null;
      await this.lockSubscription(transaction, initial.subscriptionId);
      const current = await transaction.serviceRelocation.findUnique({
        where: { id },
        include: relocationInclude,
      });
      if (
        !current ||
        !(
          [
            ServiceRelocationStatus.SCHEDULED,
            ServiceRelocationStatus.PARTIALLY_COMPLETED,
            ServiceRelocationStatus.MANUAL_REVIEW_REQUIRED,
          ] as ServiceRelocationStatus[]
        ).includes(current.status) ||
        current.provisioningStatus !== ServiceProvisioningStatus.COMPLETED ||
        !current.newServiceActivatedAt
      ) {
        return null;
      }
      const updated = await transaction.serviceRelocation.update({
        where: { id },
        data: {
          status: ServiceRelocationStatus.COMPLETED,
          oldServiceDisconnectionStatus: CancellationProviderStatus.COMPLETED,
          oldServiceDisconnectedAt: completedAt,
          completedAt,
          version: { increment: 1 },
        },
        include: relocationInclude,
      });
      await transaction.auditLog.createMany({
        data: [
          {
            action: 'OLD_SERVICE_DISCONNECTED',
            entityType: 'ServiceRelocation',
            entityId: id,
            metadata: { serviceAddressId: current.oldServiceAddressId },
          },
          {
            action: 'RELOCATION_COMPLETED',
            entityType: 'ServiceRelocation',
            entityId: id,
            metadata: { subscriptionId: current.subscriptionId },
          },
        ],
      });
      return updated;
    });
    if (completed) await this.notify('COMPLETED', completed);
  }

  private async loadEligibleSubscription(subscriptionId: string, actor: AuthenticatedUser) {
    return this.prisma.$transaction((transaction) =>
      this.findEligibleSubscription(transaction, subscriptionId, actor),
    );
  }

  private async findEligibleSubscription(
    transaction: Prisma.TransactionClient,
    subscriptionId: string,
    actor: AuthenticatedUser,
  ) {
    const subscription = await transaction.subscription.findFirst({
      where:
        actor.role === Role.CUSTOMER
          ? { id: subscriptionId, customer: { userId: actor.id } }
          : { id: subscriptionId },
      include: {
        customer: { include: { addresses: true } },
        currentServiceAddress: true,
        plan: true,
      },
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('Only an active internet subscription can be relocated.');
    }
    return subscription;
  }

  private async assertSubscriptionAccess(subscriptionId: string, actor: AuthenticatedUser) {
    const subscription = await this.prisma.subscription.findFirst({
      where:
        actor.role === Role.CUSTOMER
          ? { id: subscriptionId, customer: { userId: actor.id } }
          : { id: subscriptionId },
      select: { id: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
  }

  private async assertNoConflicts(transaction: Prisma.TransactionClient, subscriptionId: string) {
    const [relocation, planChange, cancellation] = await Promise.all([
      transaction.serviceRelocation.count({
        where: { subscriptionId, status: { in: activeRelocationStatuses } },
      }),
      transaction.planChangeRequest.count({
        where: { sourceSubscriptionId: subscriptionId, status: { in: activePlanChangeStatuses } },
      }),
      transaction.cancellationRequest.count({
        where: {
          subscriptionId,
          status: {
            in: ['REQUESTED', 'SCHEDULED', 'PROCESSING', 'DISCONNECTION_PENDING', 'FAILED'],
          },
        },
      }),
    ]);
    if (relocation) throw new ConflictException('An active relocation already exists.');
    if (planChange) {
      throw new ConflictException(
        'Complete or cancel the pending plan change before moving this service.',
      );
    }
    if (cancellation) {
      throw new ConflictException(
        'Revoke or complete the open cancellation before moving this service.',
      );
    }
  }

  private async assertNoOperationalConflict(
    transaction: Prisma.TransactionClient,
    subscriptionId: string,
    relocationId: string,
  ) {
    const [planChange, cancellation, otherRelocation] = await Promise.all([
      transaction.planChangeRequest.count({
        where: { sourceSubscriptionId: subscriptionId, status: { in: activePlanChangeStatuses } },
      }),
      transaction.cancellationRequest.count({
        where: {
          subscriptionId,
          status: {
            in: ['REQUESTED', 'SCHEDULED', 'PROCESSING', 'DISCONNECTION_PENDING', 'FAILED'],
          },
        },
      }),
      transaction.serviceRelocation.count({
        where: {
          subscriptionId,
          id: { not: relocationId },
          status: { in: activeRelocationStatuses },
        },
      }),
    ]);
    if (planChange || cancellation || otherRelocation) {
      throw new ConflictException(
        'Another subscription operation must be resolved before this relocation can continue.',
      );
    }
  }

  private async ensureCurrentServiceAddress(
    transaction: Prisma.TransactionClient,
    subscription: Awaited<ReturnType<RelocationsService['findEligibleSubscription']>>,
  ) {
    if (subscription.currentServiceAddress) return subscription.currentServiceAddress;
    const legacy =
      subscription.customer.addresses.find((address) => address.type === AddressType.SERVICE) ??
      subscription.customer;
    const created = await transaction.serviceAddress.create({
      data: {
        customerId: subscription.customerId,
        addressLine1: legacy.addressLine1,
        addressLine2: legacy.addressLine2,
        suburb: legacy.suburb,
        state: legacy.state,
        postcode: legacy.postcode,
      },
    });
    await transaction.subscription.update({
      where: { id: subscription.id },
      data: { currentServiceAddressId: created.id },
    });
    return created;
  }

  private serviceAddressData(
    customerId: string,
    address: NormalizedAddressSuggestion,
    qualification: {
      technology: RelocationRecord['newTechnology'];
      maximumSpeedMbps: number;
      checkedAt: string;
      compatiblePlanIds: string[];
    },
  ): Prisma.ServiceAddressUncheckedCreateInput {
    const addressLine1 =
      [address.houseNumber, address.street].filter(Boolean).join(' ').trim() ||
      address.formattedAddress.split(',')[0]?.trim();
    const suburb = address.suburb ?? address.city;
    const state = address.stateCode?.trim().toUpperCase();
    if (!addressLine1 || !suburb || !state || !address.postcode) {
      throw new BadRequestException(
        'The qualified address is incomplete. Select a more specific street address.',
      );
    }
    return {
      customerId,
      addressLine1,
      addressLine2: address.unit,
      suburb,
      state,
      postcode: address.postcode,
      countryCode: address.countryCode?.trim().toUpperCase() || 'AU',
      latitude: address.latitude,
      longitude: address.longitude,
      provider: address.provider,
      providerAddressId: address.providerAddressId,
      externalLocationId: address.providerAddressId,
      technology: qualification.technology,
      maximumSpeedMbps: qualification.maximumSpeedMbps,
      qualification: {
        checkedAt: qualification.checkedAt,
        compatiblePlanIds: qualification.compatiblePlanIds,
        source: 'DATABASE_ESTIMATE',
      },
    };
  }

  private async findForActor(
    transaction: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
  ) {
    const relocation = await transaction.serviceRelocation.findFirst({
      where: actor.role === Role.CUSTOMER ? { id, customer: { userId: actor.id } } : { id },
      include: relocationInclude,
    });
    if (!relocation) throw new NotFoundException('Relocation request not found.');
    return relocation;
  }

  private toResponse(relocation: RelocationRecord) {
    const {
      providerPayload,
      providerIdempotencyKey,
      providerProvisioningId,
      providerName,
      providerDisconnectionId,
      disconnectionProviderPayload,
      nextMockProvisioningOutcome,
      nextMockDisconnectionOutcome,
      statusBeforeManualReview,
      externalLocationId,
      requestedBy,
      cancelledBy,
      ...safe
    } = relocation;
    void providerPayload;
    void providerIdempotencyKey;
    void providerProvisioningId;
    void providerName;
    void providerDisconnectionId;
    void disconnectionProviderPayload;
    void nextMockProvisioningOutcome;
    void nextMockDisconnectionOutcome;
    void statusBeforeManualReview;
    void externalLocationId;
    void requestedBy;
    void cancelledBy;
    return {
      ...safe,
      oldServiceAddress: this.publicAddress(relocation.oldServiceAddress),
      newServiceAddress: this.publicAddress(relocation.newServiceAddress),
      providerMode: this.provider.simulated ? 'SIMULATED' : 'LIVE',
      canConfirm: relocation.status === ServiceRelocationStatus.AWAITING_CONFIRMATION,
      canCancel:
        cancellableRelocationStatuses.includes(relocation.status) &&
        !relocation.newServiceActivatedAt,
      canRetry: relocation.status === ServiceRelocationStatus.FAILED,
    };
  }

  private internalCapabilities(relocation: RelocationRecord, actor: AuthenticatedUser) {
    const isAdmin = actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN;
    const isSuperAdmin = actor.role === Role.SUPER_ADMIN;
    const canSimulateProvisioning =
      isAdmin &&
      this.provider.simulated &&
      (processableRelocationStatuses.includes(relocation.status) ||
        (relocation.status === ServiceRelocationStatus.FAILED &&
          relocation.attemptCount < this.maxProvisioningAttempts));
    const canSimulateDisconnection =
      isAdmin &&
      this.provider.simulated &&
      Boolean(relocation.newServiceActivatedAt) &&
      relocation.provisioningStatus === ServiceProvisioningStatus.COMPLETED &&
      relocation.status === ServiceRelocationStatus.PARTIALLY_COMPLETED &&
      relocation.oldServiceDisconnectionStatus !== CancellationProviderStatus.COMPLETED &&
      !(
        relocation.oldServiceDisconnectionStatus === CancellationProviderStatus.FAILED &&
        relocation.disconnectionAttemptCount >= this.maxDisconnectionAttempts
      );
    return {
      canAddNote: ([Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN] as Role[]).includes(actor.role),
      canConfirm: isAdmin && relocation.status === ServiceRelocationStatus.AWAITING_CONFIRMATION,
      canCancel:
        isAdmin &&
        cancellableRelocationStatuses.includes(relocation.status) &&
        !relocation.newServiceActivatedAt,
      canRetryQualification:
        isAdmin &&
        !relocation.newServiceActivatedAt &&
        reschedulableRelocationStatuses.includes(relocation.status),
      canRetryProvisioning:
        isAdmin &&
        relocation.status === ServiceRelocationStatus.FAILED &&
        relocation.attemptCount < this.maxProvisioningAttempts,
      canRetryDisconnection:
        isAdmin &&
        relocation.oldServiceDisconnectionStatus === CancellationProviderStatus.FAILED &&
        relocation.disconnectionAttemptCount < this.maxDisconnectionAttempts,
      canReschedule:
        isAdmin &&
        !relocation.newServiceActivatedAt &&
        reschedulableRelocationStatuses.includes(relocation.status),
      canEscalate:
        actor.role === Role.ADMIN &&
        !(
          [
            ServiceRelocationStatus.COMPLETED,
            ServiceRelocationStatus.CANCELLED,
            ServiceRelocationStatus.FORCE_CLOSED,
          ] as ServiceRelocationStatus[]
        ).includes(relocation.status),
      canConfigureDemo: canSimulateProvisioning || canSimulateDisconnection,
      canSimulateProvisioning,
      canSimulateDisconnection,
      canOverride: isSuperAdmin,
      maxProvisioningAttempts: this.maxProvisioningAttempts,
      maxDisconnectionAttempts: this.maxDisconnectionAttempts,
    };
  }

  private async requireInternalRelocation(id: string) {
    const relocation = await this.prisma.serviceRelocation.findUnique({
      where: { id },
      include: relocationInclude,
    });
    if (!relocation) throw new NotFoundException('Relocation request not found.');
    return relocation;
  }

  private audit(
    transaction: Prisma.TransactionClient,
    relocationId: string,
    actor: AuthenticatedUser,
    action: string,
    metadata: Prisma.InputJsonObject = {},
  ) {
    return transaction.auditLog.create({
      data: {
        actorUserId: actor.id,
        action,
        entityType: 'ServiceRelocation',
        entityId: relocationId,
        metadata: { ...metadata, actorRole: actor.role },
      },
    });
  }

  private endOfUtcDay(value: Date) {
    return new Date(value.getTime() + 86_400_000 - 1);
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async notify(
    event: 'REQUESTED' | 'CONFIRMED' | 'SCHEDULED' | 'FAILED' | 'COMPLETED',
    relocation: RelocationRecord,
  ) {
    try {
      await this.notifications.sendRelocationNotification({
        event,
        relocationRequestId: relocation.id,
        customerName: relocation.customer.firstName,
        customerEmail: relocation.customer.email,
        oldAddress: this.formatAddress(relocation.oldServiceAddress),
        newAddress: this.formatAddress(relocation.newServiceAddress),
        planName: relocation.requestedPlan.name,
        requestedMoveDate: relocation.requestedMoveDate,
        failureReason: relocation.failureReason,
      });
    } catch (error: unknown) {
      this.logger.warn(
        JSON.stringify({
          event: 'relocation_notification_queue_failed',
          relocationId: relocation.id,
          notificationEvent: event,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  private formatAddress(address: {
    addressLine1: string;
    addressLine2: string | null;
    suburb: string;
    state: string;
    postcode: string;
  }) {
    return [
      address.addressLine2,
      address.addressLine1,
      address.suburb,
      address.state,
      address.postcode,
    ]
      .filter(Boolean)
      .join(', ');
  }

  private publicAddress(address: RelocationRecord['oldServiceAddress']) {
    return {
      id: address.id,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      suburb: address.suburb,
      state: address.state,
      postcode: address.postcode,
      countryCode: address.countryCode,
      technology: address.technology,
      serviceClass: address.serviceClass,
      maximumSpeedMbps: address.maximumSpeedMbps,
    };
  }

  private parseDate(value: string, label: string) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${label} must be a valid calendar date.`);
    }
    return parsed;
  }

  private assertDates(moveDate: Date, disconnectionDate: Date | null) {
    const today = this.todayUtc();
    if (moveDate < today)
      throw new BadRequestException('Requested move date cannot be in the past.');
    const latest = new Date(today);
    latest.setUTCFullYear(latest.getUTCFullYear() + 1);
    if (moveDate > latest) {
      throw new BadRequestException('Requested move date must be within the next 12 months.');
    }
    if (disconnectionDate && disconnectionDate < moveDate) {
      throw new BadRequestException(
        'Old service disconnection date cannot be before the requested move date.',
      );
    }
  }

  private todayUtc() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  private lockSubscription(transaction: Prisma.TransactionClient, subscriptionId: string) {
    return transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subscriptionId}))`;
  }
}
