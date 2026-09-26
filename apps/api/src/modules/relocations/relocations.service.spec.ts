import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AccessTechnology,
  CancellationProviderStatus,
  CoverageResultStatus,
  MockRelocationOutcome,
  Role,
  ServiceProvisioningStatus,
  ServiceRelocationStatus,
  SubscriptionStatus,
} from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RelocationOverrideAction } from './dto/relocation.dto';
import { RelocationsService } from './relocations.service';

const actor: AuthenticatedUser = {
  id: '8d64905c-1260-48cb-8d80-3a72ed2376c4',
  email: 'customer@example.test',
  role: Role.CUSTOMER,
  roles: [Role.CUSTOMER],
};
const adminActor: AuthenticatedUser = {
  id: 'd61115ff-f5e3-40dc-8dbd-4d1db0085b14',
  email: 'admin@example.test',
  role: Role.ADMIN,
  roles: [Role.ADMIN],
};
const superAdminActor: AuthenticatedUser = {
  id: '65196ccd-626f-4bb6-b79a-88d529cfc86d',
  email: 'super@example.test',
  role: Role.SUPER_ADMIN,
  roles: [Role.SUPER_ADMIN],
};
const serviceAddress = {
  id: 'old-address-id',
  customerId: 'customer-id',
  addressLine1: '10 Example Street',
  addressLine2: null,
  suburb: 'Adelaide',
  state: 'SA',
  postcode: '5000',
  countryCode: 'AU',
  latitude: null,
  longitude: null,
  provider: null,
  providerAddressId: null,
  externalLocationId: null,
  technology: AccessTechnology.FTTP,
  serviceClass: null,
  maximumSpeedMbps: 1000,
  qualification: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const plan = {
  id: 'plan-id',
  name: 'NBN 100/20',
  description: null,
  highlights: [],
  downloadMbps: 100,
  uploadMbps: 20,
  monthlyCents: 8900,
  isActive: true,
  isPublic: true,
  isAvailable: true,
  isFeatured: false,
  tierRank: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const subscription = {
  id: 'subscription-id',
  customerId: 'customer-id',
  planId: plan.id,
  status: SubscriptionStatus.ACTIVE,
  currentServiceAddressId: serviceAddress.id,
  currentServiceAddress: serviceAddress,
  plan,
  customer: {
    id: 'customer-id',
    userId: actor.id,
    firstName: 'Asha',
    lastName: 'Shah',
    email: actor.email,
    addressLine1: serviceAddress.addressLine1,
    addressLine2: null,
    suburb: serviceAddress.suburb,
    state: serviceAddress.state,
    postcode: serviceAddress.postcode,
    addresses: [],
  },
};

function makeService(input?: {
  subscriptionRecord?: typeof subscription | null;
  coverageResult?: ReturnType<typeof coverageResult>;
  activeRelocations?: number;
  activePlanChanges?: number;
  activeCancellations?: number;
}) {
  const newAddress = {
    ...serviceAddress,
    id: 'new-address-id',
    addressLine1: '25 Example Street',
    provider: 'geoapify',
    providerAddressId: 'provider-address-id',
  };
  const record = relocationRecord(newAddress);
  const transaction = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    subscription: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          input && 'subscriptionRecord' in input ? input.subscriptionRecord : subscription,
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    internetPlan: { findUnique: jest.fn().mockResolvedValue(plan) },
    serviceAddress: { create: jest.fn().mockResolvedValue(newAddress) },
    serviceRelocation: {
      count: jest.fn().mockResolvedValue(input?.activeRelocations ?? 0),
      create: jest.fn().mockResolvedValue(record),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    planChangeRequest: { count: jest.fn().mockResolvedValue(input?.activePlanChanges ?? 0) },
    cancellationRequest: { count: jest.fn().mockResolvedValue(input?.activeCancellations ?? 0) },
    customerAddress: { upsert: jest.fn().mockResolvedValue({}) },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
  const prisma = {
    ...transaction,
    $transaction: jest.fn((operation: unknown) => {
      if (Array.isArray(operation)) return Promise.all(operation);
      return (operation as (client: typeof transaction) => unknown)(transaction);
    }),
  };
  const coverage = {
    check: jest.fn().mockResolvedValue(input?.coverageResult ?? coverageResult()),
    consumeQualificationForPlan: jest.fn().mockResolvedValue({
      address: {
        provider: 'geoapify',
        providerAddressId: 'provider-address-id',
        formattedAddress: '25 Example Street, Adelaide SA 5000',
        unit: null,
        houseNumber: '25',
        street: 'Example Street',
        suburb: 'Adelaide',
        city: 'Adelaide',
        state: 'South Australia',
        stateCode: 'SA',
        postcode: '5000',
        countryCode: 'au',
        latitude: -34.92,
        longitude: 138.6,
      },
      compatiblePlanIds: [plan.id],
      technology: AccessTechnology.FTTP,
      maximumSpeedMbps: 1000,
      checkedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  };
  const provider = {
    name: 'MOCK_MNF',
    simulated: true,
    requestProvisioning: jest.fn(),
    getProvisioningStatus: jest.fn(),
    requestDisconnection: jest.fn(),
    getDisconnectionStatus: jest.fn(),
  };
  const notifications = { sendRelocationNotification: jest.fn().mockResolvedValue({}) };
  return {
    service: new RelocationsService(
      prisma as unknown as PrismaService,
      coverage as never,
      provider as never,
      notifications as never,
    ),
    prisma,
    transaction,
    coverage,
    provider,
    notifications,
    record,
  };
}

describe('RelocationsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lets the owner of an active subscription qualify a serviceable address', async () => {
    const { service } = makeService();
    await expect(service.qualify(subscription.id, 'selection-token', actor)).resolves.toEqual(
      expect.objectContaining({ available: true, currentPlanCompatible: true }),
    );
  });

  it('records a non-serviceable qualification without changing the subscription', async () => {
    const result = coverageResult({
      available: false,
      plans: [],
      status: CoverageResultStatus.NOT_AVAILABLE,
    });
    const { service, transaction } = makeService({ coverageResult: result });
    await expect(service.qualify(subscription.id, 'selection-token', actor)).resolves.toEqual(
      expect.objectContaining({ available: false, currentPlanCompatible: false }),
    );
    expect(transaction.subscription.update).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ADDRESS_NOT_SERVICEABLE' }),
      }),
    );
  });

  it('reports the existing plan as incompatible when SQ omits it', async () => {
    const alternative = { ...plan, id: 'alternative-plan', name: 'NBN 50/20' };
    const result = coverageResult({ plans: [alternative] });
    const { service } = makeService({ coverageResult: result });
    await expect(service.qualify(subscription.id, 'selection-token', actor)).resolves.toEqual(
      expect.objectContaining({ currentPlanCompatible: false }),
    );
  });

  it('creates a relocation while preserving the active subscription and old address', async () => {
    const { service, transaction } = makeService();
    const result = await service.create(
      subscription.id,
      {
        qualificationToken: 'q'.repeat(43),
        requestedPlanId: plan.id,
        requestedMoveDate: futureDate(),
      },
      actor,
    );
    expect(result.status).toBe(ServiceRelocationStatus.AWAITING_CONFIRMATION);
    expect(transaction.subscription.update).not.toHaveBeenCalled();
    expect(transaction.serviceRelocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ oldServiceAddressId: serviceAddress.id }),
      }),
    );
    expect(transaction.serviceAddress.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ countryCode: 'AU' }) }),
    );
  });

  it('prevents a duplicate active relocation', async () => {
    const { service } = makeService({ activeRelocations: 1 });
    await expect(
      service.create(
        subscription.id,
        {
          qualificationToken: 'q'.repeat(43),
          requestedPlanId: plan.id,
          requestedMoveDate: futureDate(),
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents relocation while a plan change is active', async () => {
    const { service } = makeService({ activePlanChanges: 1 });
    await expect(createRelocation(service)).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents relocation while cancellation is active', async () => {
    const { service } = makeService({ activeCancellations: 1 });
    await expect(createRelocation(service)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects access by a customer who does not own the subscription', async () => {
    const { service } = makeService({ subscriptionRecord: null });
    await expect(service.qualify(subscription.id, 'selection-token', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cancels a reversible relocation without cancelling the subscription', async () => {
    const { service, transaction, record } = makeService();
    transaction.serviceRelocation.findFirst.mockResolvedValue(record);
    transaction.serviceRelocation.update.mockResolvedValue({
      ...record,
      status: ServiceRelocationStatus.CANCELLED,
    });
    await expect(service.cancel(record.id, actor)).resolves.toEqual(
      expect.objectContaining({ status: ServiceRelocationStatus.CANCELLED }),
    );
    expect(transaction.subscription.update).not.toHaveBeenCalled();
  });

  it('activates atomically and changes the authoritative service address exactly once', async () => {
    const { service, transaction, record } = makeService();
    const disconnectionDate = new Date();
    disconnectionDate.setUTCDate(disconnectionDate.getUTCDate() + 60);
    const provisioning = {
      ...record,
      status: ServiceRelocationStatus.PROVISIONING,
      requestedOldServiceDisconnectionDate: disconnectionDate,
    };
    const completed = {
      ...provisioning,
      status: ServiceRelocationStatus.PARTIALLY_COMPLETED,
      provisioningStatus: ServiceProvisioningStatus.COMPLETED,
      newServiceActivatedAt: new Date(),
    };
    transaction.serviceRelocation.findUnique
      .mockResolvedValueOnce(provisioning)
      .mockResolvedValueOnce(provisioning)
      .mockResolvedValueOnce(completed);
    transaction.serviceRelocation.update.mockResolvedValue(completed);
    const apply = (
      service as unknown as {
        applyProviderResult: (id: string, result: object) => Promise<void>;
      }
    ).applyProviderResult.bind(service);
    const providerResult = {
      providerReference: 'provider-reference',
      status: ServiceProvisioningStatus.COMPLETED,
      payload: { simulated: true },
    };
    await apply(record.id, providerResult);
    await apply(record.id, providerResult);
    expect(transaction.subscription.update).toHaveBeenCalledTimes(1);
    expect(transaction.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentServiceAddressId: record.newServiceAddressId }),
      }),
    );
  });

  it('keeps the old service authoritative when provisioning fails', async () => {
    const { service, transaction, record } = makeService();
    transaction.serviceRelocation.findUnique.mockResolvedValue({
      ...record,
      status: ServiceRelocationStatus.PROVISIONING,
    });
    transaction.serviceRelocation.update.mockResolvedValue({
      ...record,
      status: ServiceRelocationStatus.FAILED,
      failureReason: 'Provider failed',
    });
    await (
      service as unknown as {
        applyProviderResult: (id: string, result: object) => Promise<void>;
      }
    ).applyProviderResult(record.id, {
      providerReference: 'provider-reference',
      status: ServiceProvisioningStatus.FAILED,
      payload: {},
      failureReason: 'Provider failed',
    });
    expect(transaction.subscription.update).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PROVISIONING_FAILED' }) }),
    );
  });

  it('keeps both the subscription and old address unchanged while provisioning is pending', async () => {
    const { service, transaction, record } = makeService();
    await (
      service as unknown as {
        applyProviderResult: (id: string, result: object) => Promise<void>;
      }
    ).applyProviderResult(record.id, {
      providerReference: 'provider-reference',
      status: ServiceProvisioningStatus.PENDING,
      payload: { pending: true },
    });
    expect(transaction.serviceRelocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provisioningStatus: ServiceProvisioningStatus.PENDING }),
      }),
    );
    expect(transaction.subscription.update).not.toHaveBeenCalled();
    expect(transaction.customerAddress.upsert).not.toHaveBeenCalled();
  });

  it('records the Admin actor when provisioning is retried', async () => {
    const { service, transaction, record } = makeService();
    const failed = {
      ...record,
      status: ServiceRelocationStatus.FAILED,
      provisioningStatus: ServiceProvisioningStatus.FAILED,
      attemptCount: 1,
    };
    transaction.serviceRelocation.findUnique.mockResolvedValue(failed);
    transaction.serviceRelocation.update.mockResolvedValue({
      ...failed,
      status: ServiceRelocationStatus.CONFIRMED,
    });
    jest.spyOn(service, 'processProvisioning').mockResolvedValue();
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: record.id } as never);

    await service.retryProvisioning(record.id, adminActor);

    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'RELOCATION_PROVISIONING_RETRY_REQUESTED',
          actorUserId: adminActor.id,
          metadata: expect.objectContaining({ actorRole: Role.ADMIN, force: false }),
        }),
      }),
    );
  });

  it('explains why simulated provisioning cannot run before confirmation', async () => {
    const { service, transaction, record } = makeService();
    transaction.serviceRelocation.findUnique.mockResolvedValue(record);

    await expect(
      service.configureDemoOutcome(
        record.id,
        {
          operation: 'PROVISIONING',
          outcome: MockRelocationOutcome.FAILED,
          processNow: true,
        },
        adminActor,
      ),
    ).rejects.toThrow('Confirm the relocation before simulating provisioning.');
    expect(transaction.serviceRelocation.update).not.toHaveBeenCalled();
  });

  it('uses the selected simulated result to retry failed provisioning immediately', async () => {
    const { service, transaction, record } = makeService();
    const failed = {
      ...record,
      status: ServiceRelocationStatus.FAILED,
      provisioningStatus: ServiceProvisioningStatus.FAILED,
      attemptCount: 1,
    };
    transaction.serviceRelocation.findUnique.mockResolvedValue(failed);
    transaction.serviceRelocation.update.mockResolvedValue(failed);
    const retry = jest.spyOn(service, 'retryProvisioning').mockResolvedValue({ id: record.id } as never);

    await service.configureDemoOutcome(
      record.id,
      {
        operation: 'PROVISIONING',
        outcome: MockRelocationOutcome.SUCCESS,
        processNow: true,
      },
      adminActor,
    );

    expect(retry).toHaveBeenCalledWith(record.id, adminActor, false, true);
  });

  it('records previous and new state for a Super Admin force-close override', async () => {
    const { service, transaction, record } = makeService();
    const failed = { ...record, status: ServiceRelocationStatus.FAILED };
    const forceClosed = { ...failed, status: ServiceRelocationStatus.FORCE_CLOSED };
    transaction.serviceRelocation.findUnique.mockResolvedValue(failed);
    transaction.serviceRelocation.update.mockResolvedValue(forceClosed);
    transaction.serviceRelocation.findUniqueOrThrow.mockResolvedValue(forceClosed);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: record.id } as never);

    await service.override(
      record.id,
      {
        action: RelocationOverrideAction.FORCE_CLOSE,
        reason: 'Operations leadership approved exceptional closure.',
      },
      superAdminActor,
    );

    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'RELOCATION_SUPER_ADMIN_OVERRIDE',
          actorUserId: superAdminActor.id,
          metadata: expect.objectContaining({
            previousStatus: ServiceRelocationStatus.FAILED,
            newStatus: ServiceRelocationStatus.FORCE_CLOSED,
            reason: 'Operations leadership approved exceptional closure.',
          }),
        }),
      }),
    );
  });

  it('activates the new address but defers old-service disconnection until a later confirmed date', async () => {
    const { service, transaction, record } = makeService();
    const disconnectionDate = new Date();
    disconnectionDate.setUTCDate(disconnectionDate.getUTCDate() + 60);
    const provisioning = {
      ...record,
      status: ServiceRelocationStatus.PROVISIONING,
      requestedOldServiceDisconnectionDate: disconnectionDate,
    };
    transaction.serviceRelocation.findUnique
      .mockResolvedValueOnce(provisioning)
      .mockResolvedValueOnce(provisioning);
    transaction.serviceRelocation.update.mockImplementation(async ({ data }) => ({
      ...provisioning,
      ...data,
      status: ServiceRelocationStatus.SCHEDULED,
    }));
    await (
      service as unknown as {
        applyProviderResult: (id: string, result: object) => Promise<void>;
      }
    ).applyProviderResult(record.id, {
      providerReference: 'provider-reference',
      status: ServiceProvisioningStatus.COMPLETED,
      payload: {},
    });
    expect(transaction.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentServiceAddressId: record.newServiceAddressId }),
      }),
    );
    expect(transaction.serviceRelocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ServiceRelocationStatus.PARTIALLY_COMPLETED,
          oldServiceDisconnectionStatus: CancellationProviderStatus.PENDING,
          oldServiceDisconnectedAt: null,
          completedAt: null,
        }),
      }),
    );
  });
});

function coverageResult(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    status: CoverageResultStatus.AVAILABLE,
    message: 'Available',
    address: {
      formattedAddress: '25 Example Street, Adelaide SA 5000',
      suburb: 'Adelaide',
      stateCode: 'SA',
      postcode: '5000',
    },
    qualification: {
      technology: AccessTechnology.FTTP,
      maximumSpeedMbps: 1000,
      source: 'DATABASE_ESTIMATE' as const,
      checkedAt: new Date().toISOString(),
    },
    plans: [plan],
    qualificationToken: 'q'.repeat(43),
    ...overrides,
  };
}

function relocationRecord(newAddress: typeof serviceAddress) {
  return {
    id: 'relocation-id',
    customerId: subscription.customerId,
    subscriptionId: subscription.id,
    oldServiceAddressId: serviceAddress.id,
    newServiceAddressId: newAddress.id,
    currentPlanId: plan.id,
    requestedPlanId: plan.id,
    requestedMoveDate: new Date(`${futureDate()}T00:00:00.000Z`),
    requestedOldServiceDisconnectionDate: null,
    qualificationStatus: CoverageResultStatus.AVAILABLE,
    qualification: {},
    externalLocationId: 'provider-address-id',
    oldTechnology: AccessTechnology.FTTP,
    newTechnology: AccessTechnology.FTTP,
    serviceClass: null,
    installationRequired: null,
    appointmentRequired: null,
    status: ServiceRelocationStatus.AWAITING_CONFIRMATION,
    provisioningStatus: null,
    oldServiceDisconnectionStatus: null,
    providerName: 'MOCK_MNF',
    providerIdempotencyKey: 'relocation-key',
    providerProvisioningId: null,
    providerPayload: null,
    attemptCount: 0,
    failureReason: null,
    requestedByUserId: actor.id,
    cancelledByUserId: null,
    confirmedAt: null,
    provisioningStartedAt: null,
    scheduledAt: null,
    newServiceActivatedAt: null,
    oldServiceDisconnectedAt: null,
    cancelledAt: null,
    completedAt: null,
    lastAttemptAt: null,
    version: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    customer: { ...subscription.customer, userId: actor.id },
    subscription: {
      id: subscription.id,
      status: SubscriptionStatus.ACTIVE,
      currentServiceAddressId: serviceAddress.id,
    },
    oldServiceAddress: serviceAddress,
    newServiceAddress: newAddress,
    currentPlan: plan,
    requestedPlan: plan,
    requestedBy: { id: actor.id, displayName: null, email: actor.email },
    cancelledBy: null,
  };
}

function futureDate() {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + 30);
  return value.toISOString().slice(0, 10);
}

function createRelocation(service: RelocationsService) {
  return service.create(
    subscription.id,
    {
      qualificationToken: 'q'.repeat(43),
      requestedPlanId: plan.id,
      requestedMoveDate: futureDate(),
    },
    actor,
  );
}
