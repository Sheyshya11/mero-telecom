import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessTechnology,
  AddressOverrideStatus,
  OperatingRegionStatus,
  PostcodeCoverageStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AddressSelectionService } from './address-selection.service';
import { normalizeAustralianStateCode } from './australian-states';
import type {
  AddressOverrideQueryDto,
  CoverageAnalyticsQueryDto,
  CreateAddressOverrideDto,
  CreateAddressOverrideFromSelectionDto,
  CreateOperatingRegionDto,
  CreatePlanCoverageRuleDto,
  CreatePostcodeCoverageDto,
  OperatingRegionQueryDto,
  PlanCoverageRuleQueryDto,
  PostcodeCoverageQueryDto,
  UpdateAddressOverrideDto,
  UpdateOperatingRegionDto,
  UpdatePlanCoverageRuleDto,
  UpdatePostcodeCoverageDto,
} from './dto/coverage-management.dto';

@Injectable()
export class CoverageManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly selections: AddressSelectionService,
  ) {}

  listRegions(query: OperatingRegionQueryDto) {
    return this.prisma.operatingRegion.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' as const } },
                { stateCode: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: {
        _count: { select: { postcodeCoverage: true, addressOverrides: true } },
      },
      orderBy: [{ countryCode: 'asc' }, { stateCode: 'asc' }],
    });
  }

  async createRegion(input: CreateOperatingRegionDto, actor: AuthenticatedUser) {
    if (input.countryCode !== 'AU') {
      throw new BadRequestException('Operating regions must use the Australian country code AU.');
    }
    return this.uniqueMutation('An operating region already exists for this state.', () =>
      this.prisma.$transaction(async (transaction) => {
        const region = await transaction.operatingRegion.create({ data: input });
        await this.audit(
          transaction,
          actor,
          'OPERATING_REGION_CREATED',
          'OperatingRegion',
          region.id,
          {
            countryCode: region.countryCode,
            stateCode: region.stateCode,
            status: region.status,
          },
        );
        return region;
      }),
    );
  }

  async updateRegion(id: string, input: UpdateOperatingRegionDto, actor: AuthenticatedUser) {
    const current = await this.region(id);
    if (input.countryCode && input.countryCode !== 'AU') {
      throw new BadRequestException('Operating regions must use the Australian country code AU.');
    }
    return this.uniqueMutation('An operating region already exists for this state.', () =>
      this.prisma.$transaction(async (transaction) => {
        const region = await transaction.operatingRegion.update({ where: { id }, data: input });
        const action =
          region.status === OperatingRegionStatus.ACTIVE && current.status !== region.status
            ? 'OPERATING_REGION_ACTIVATED'
            : region.status === OperatingRegionStatus.DISABLED && current.status !== region.status
              ? 'OPERATING_REGION_DISABLED'
              : 'OPERATING_REGION_UPDATED';
        await this.audit(transaction, actor, action, 'OperatingRegion', region.id, {
          countryCode: region.countryCode,
          stateCode: region.stateCode,
          status: region.status,
        });
        return region;
      }),
    );
  }

  listPostcodes(query: PostcodeCoverageQueryDto) {
    return this.prisma.postcodeCoverage.findMany({
      where: {
        ...(query.operatingRegionId ? { operatingRegionId: query.operatingRegionId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.search ? { postcode: { contains: query.search } } : {}),
      },
      include: { operatingRegion: true },
      orderBy: [{ operatingRegion: { stateCode: 'asc' } }, { postcode: 'asc' }],
    });
  }

  async createPostcode(input: CreatePostcodeCoverageDto, actor: AuthenticatedUser) {
    await this.region(input.operatingRegionId);
    this.validateQualification(input.status, input.technology, input.maximumSpeedMbps);
    return this.uniqueMutation('Coverage already exists for this exact regional postcode.', () =>
      this.prisma.$transaction(async (transaction) => {
        const record = await transaction.postcodeCoverage.create({
          data: {
            ...input,
            availabilityDate: this.date(input.availabilityDate),
          },
        });
        await this.audit(
          transaction,
          actor,
          'POSTCODE_COVERAGE_CREATED',
          'PostcodeCoverage',
          record.id,
          this.postcodeAudit(record),
        );
        return record;
      }),
    );
  }

  async updatePostcode(id: string, input: UpdatePostcodeCoverageDto, actor: AuthenticatedUser) {
    const current = await this.postcode(id);
    if (input.operatingRegionId) await this.region(input.operatingRegionId);
    this.validateQualification(
      input.status ?? current.status,
      input.technology === undefined ? current.technology : input.technology,
      input.maximumSpeedMbps === undefined ? current.maximumSpeedMbps : input.maximumSpeedMbps,
    );
    return this.uniqueMutation('Coverage already exists for this exact regional postcode.', () =>
      this.prisma.$transaction(async (transaction) => {
        const record = await transaction.postcodeCoverage.update({
          where: { id },
          data: {
            ...input,
            availabilityDate: this.date(input.availabilityDate),
          },
        });
        const action =
          input.isActive === false && current.isActive
            ? 'POSTCODE_COVERAGE_DISABLED'
            : 'POSTCODE_COVERAGE_UPDATED';
        await this.audit(
          transaction,
          actor,
          action,
          'PostcodeCoverage',
          record.id,
          this.postcodeAudit(record),
        );
        return record;
      }),
    );
  }

  listOverrides(query: AddressOverrideQueryDto) {
    return this.prisma.addressCoverageOverride.findMany({
      where: {
        ...(query.operatingRegionId ? { operatingRegionId: query.operatingRegionId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { formattedAddress: { contains: query.search, mode: 'insensitive' as const } },
                { providerAddressId: { contains: query.search, mode: 'insensitive' as const } },
                { postcode: { contains: query.search } },
              ],
            }
          : {}),
      },
      include: { operatingRegion: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createOverride(input: CreateAddressOverrideDto, actor: AuthenticatedUser) {
    const region = await this.region(input.operatingRegionId);
    if (input.stateCode !== region.stateCode) {
      throw new BadRequestException('The override state must match its operating region.');
    }
    this.validateOverride(input.status, input.technology, input.maximumSpeedMbps);
    return this.uniqueMutation('An override already exists for this provider address.', () =>
      this.prisma.$transaction(async (transaction) => {
        const record = await transaction.addressCoverageOverride.create({
          data: {
            ...input,
            availabilityDate: this.date(input.availabilityDate),
          },
        });
        await this.audit(
          transaction,
          actor,
          'ADDRESS_COVERAGE_OVERRIDE_CREATED',
          'AddressCoverageOverride',
          record.id,
          this.overrideAudit(record),
        );
        return record;
      }),
    );
  }

  async createOverrideFromSelection(
    input: CreateAddressOverrideFromSelectionDto,
    actor: AuthenticatedUser,
  ) {
    const address = await this.selections.consume(input.selectionToken);
    const stateCode = normalizeAustralianStateCode(address.stateCode, address.state);
    if (!stateCode || !address.postcode) {
      throw new BadRequestException(
        'The selected address does not contain a recognised Australian state and postcode.',
      );
    }
    return this.createOverride(
      {
        operatingRegionId: input.operatingRegionId,
        provider: address.provider,
        providerAddressId: address.providerAddressId,
        formattedAddress: address.formattedAddress,
        stateCode,
        postcode: address.postcode,
        status: input.status,
        technology: input.technology,
        maximumSpeedMbps: input.maximumSpeedMbps,
        availabilityDate: input.availabilityDate,
        isActive: input.isActive,
        adminNotes: input.adminNotes,
      },
      actor,
    );
  }

  async updateOverride(id: string, input: UpdateAddressOverrideDto, actor: AuthenticatedUser) {
    const current = await this.override(id);
    const region = input.operatingRegionId
      ? await this.region(input.operatingRegionId)
      : await this.region(current.operatingRegionId);
    const stateCode = input.stateCode ?? current.stateCode;
    if (stateCode !== region.stateCode) {
      throw new BadRequestException('The override state must match its operating region.');
    }
    this.validateOverride(
      input.status ?? current.status,
      input.technology === undefined ? current.technology : input.technology,
      input.maximumSpeedMbps === undefined ? current.maximumSpeedMbps : input.maximumSpeedMbps,
    );
    return this.uniqueMutation('An override already exists for this provider address.', () =>
      this.prisma.$transaction(async (transaction) => {
        const record = await transaction.addressCoverageOverride.update({
          where: { id },
          data: {
            ...input,
            provider: input.provider?.toLowerCase(),
            availabilityDate: this.date(input.availabilityDate),
          },
        });
        const action =
          input.isActive === false && current.isActive
            ? 'ADDRESS_COVERAGE_OVERRIDE_DISABLED'
            : 'ADDRESS_COVERAGE_OVERRIDE_UPDATED';
        await this.audit(
          transaction,
          actor,
          action,
          'AddressCoverageOverride',
          record.id,
          this.overrideAudit(record),
        );
        return record;
      }),
    );
  }

  listPlanRules(query: PlanCoverageRuleQueryDto) {
    return this.prisma.planCoverageRule.findMany({
      where: {
        ...(query.operatingRegionId ? { operatingRegionId: query.operatingRegionId } : {}),
        ...(query.planId ? { planId: query.planId } : {}),
        ...(query.technology ? { technology: query.technology } : {}),
        ...(query.search
          ? { plan: { name: { contains: query.search, mode: 'insensitive' as const } } }
          : {}),
      },
      include: { plan: true, operatingRegion: true },
      orderBy: [{ plan: { tierRank: 'asc' } }, { technology: 'asc' }],
    });
  }

  async createPlanRule(input: CreatePlanCoverageRuleDto, actor: AuthenticatedUser) {
    await this.validatePlanRule(input);
    const scopeKey = this.scopeKey(input.operatingRegionId, input.postcode);
    return this.uniqueMutation(
      'This plan already has a rule for the selected technology and scope.',
      () =>
        this.prisma.$transaction(async (transaction) => {
          const rule = await transaction.planCoverageRule.create({ data: { ...input, scopeKey } });
          await this.audit(
            transaction,
            actor,
            'PLAN_COVERAGE_COMPATIBILITY_CREATED',
            'PlanCoverageRule',
            rule.id,
            this.ruleAudit(rule),
          );
          return rule;
        }),
    );
  }

  async updatePlanRule(id: string, input: UpdatePlanCoverageRuleDto, actor: AuthenticatedUser) {
    const current = await this.planRule(id);
    const merged = {
      planId: input.planId ?? current.planId,
      technology: input.technology ?? current.technology,
      minimumSpeedMbps:
        input.minimumSpeedMbps === undefined ? current.minimumSpeedMbps : input.minimumSpeedMbps,
      maximumSpeedMbps:
        input.maximumSpeedMbps === undefined ? current.maximumSpeedMbps : input.maximumSpeedMbps,
      operatingRegionId:
        input.operatingRegionId === undefined ? current.operatingRegionId : input.operatingRegionId,
      postcode: input.postcode === undefined ? current.postcode : input.postcode,
      isActive: input.isActive ?? current.isActive,
    };
    await this.validatePlanRule(merged);
    const scopeKey = this.scopeKey(merged.operatingRegionId, merged.postcode);
    return this.uniqueMutation(
      'This plan already has a rule for the selected technology and scope.',
      () =>
        this.prisma.$transaction(async (transaction) => {
          const rule = await transaction.planCoverageRule.update({
            where: { id },
            data: { ...input, scopeKey },
          });
          await this.audit(
            transaction,
            actor,
            rule.isActive
              ? 'PLAN_COVERAGE_COMPATIBILITY_UPDATED'
              : 'PLAN_COVERAGE_COMPATIBILITY_DISABLED',
            'PlanCoverageRule',
            rule.id,
            this.ruleAudit(rule),
          );
          return rule;
        }),
    );
  }

  async analytics(query: CoverageAnalyticsQueryDto) {
    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);
    const [total, byStatus, byState, recent] = await Promise.all([
      this.prisma.coverageSearch.count({ where: { createdAt: { gte: since } } }),
      this.prisma.coverageSearch.groupBy({
        by: ['resultStatus'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { resultStatus: 'asc' },
      }),
      this.prisma.coverageSearch.groupBy({
        by: ['stateCode'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { stateCode: 'asc' },
      }),
      this.prisma.coverageSearch.findMany({
        where: { createdAt: { gte: since } },
        select: {
          id: true,
          requestIdentifier: true,
          resultStatus: true,
          stateCode: true,
          postcode: true,
          technology: true,
          plansReturned: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return {
      periodDays: query.days,
      total,
      byStatus: byStatus.map((entry) => ({
        status: entry.resultStatus,
        count: entry._count._all,
      })),
      byState: byState.map((entry) => ({
        stateCode: entry.stateCode,
        count: entry._count._all,
      })),
      recent,
    };
  }

  private async region(id: string) {
    const record = await this.prisma.operatingRegion.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Operating region not found.');
    return record;
  }

  private async postcode(id: string) {
    const record = await this.prisma.postcodeCoverage.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Postcode coverage record not found.');
    return record;
  }

  private async override(id: string) {
    const record = await this.prisma.addressCoverageOverride.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Address coverage override not found.');
    return record;
  }

  private async planRule(id: string) {
    const record = await this.prisma.planCoverageRule.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Plan coverage rule not found.');
    return record;
  }

  private validateQualification(
    status: PostcodeCoverageStatus,
    technology: unknown,
    maximumSpeedMbps: number | null | undefined,
  ): void {
    if (status === PostcodeCoverageStatus.AVAILABLE && (!technology || !maximumSpeedMbps)) {
      throw new BadRequestException(
        'Available postcode coverage requires a technology and maximum speed.',
      );
    }
  }

  private validateOverride(
    status: AddressOverrideStatus,
    technology: unknown,
    maximumSpeedMbps: number | null | undefined,
  ): void {
    if (status === AddressOverrideStatus.AVAILABLE && (!technology || !maximumSpeedMbps)) {
      throw new BadRequestException(
        'An available address override requires a technology and maximum speed.',
      );
    }
  }

  private async validatePlanRule(input: {
    planId: string;
    minimumSpeedMbps?: number | null;
    maximumSpeedMbps?: number | null;
    operatingRegionId?: string | null;
    postcode?: string | null;
  }): Promise<void> {
    if (
      input.minimumSpeedMbps &&
      input.maximumSpeedMbps &&
      input.minimumSpeedMbps > input.maximumSpeedMbps
    ) {
      throw new BadRequestException('Minimum speed cannot exceed maximum speed.');
    }
    if (input.postcode && !input.operatingRegionId) {
      throw new BadRequestException('A postcode-specific plan rule requires an operating region.');
    }
    const [plan] = await Promise.all([
      this.prisma.internetPlan.findUnique({ where: { id: input.planId }, select: { id: true } }),
      input.operatingRegionId ? this.region(input.operatingRegionId) : Promise.resolve(null),
    ]);
    if (!plan) throw new NotFoundException('Internet plan not found.');
  }

  private scopeKey(regionId?: string | null, postcode?: string | null): string {
    return `region:${regionId ?? '*'}:postcode:${postcode ?? '*'}`;
  }

  private date(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined;
    return value === null ? null : new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }

  private uniqueMutation<T>(message: string, operation: () => Promise<T>): Promise<T> {
    return operation().catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(message);
      }
      throw error;
    });
  }

  private audit(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ) {
    return transaction.auditLog.create({
      data: { actorUserId: actor.id, action, entityType, entityId, metadata },
    });
  }

  private postcodeAudit(record: {
    operatingRegionId: string;
    postcode: string;
    status: PostcodeCoverageStatus;
    technology: AccessTechnology | null;
    maximumSpeedMbps: number | null;
    isActive: boolean;
  }) {
    return {
      operatingRegionId: record.operatingRegionId,
      postcode: record.postcode,
      status: record.status,
      technology: record.technology,
      maximumSpeedMbps: record.maximumSpeedMbps,
      isActive: record.isActive,
    };
  }

  private overrideAudit(record: {
    operatingRegionId: string;
    provider: string;
    providerAddressId: string;
    status: AddressOverrideStatus;
    technology: AccessTechnology | null;
    maximumSpeedMbps: number | null;
    isActive: boolean;
  }) {
    return {
      operatingRegionId: record.operatingRegionId,
      provider: record.provider,
      providerAddressId: record.providerAddressId,
      status: record.status,
      technology: record.technology,
      maximumSpeedMbps: record.maximumSpeedMbps,
      isActive: record.isActive,
    };
  }

  private ruleAudit(record: {
    planId: string;
    technology: AccessTechnology;
    operatingRegionId: string | null;
    postcode: string | null;
    minimumSpeedMbps: number | null;
    maximumSpeedMbps: number | null;
    isActive: boolean;
  }) {
    return {
      planId: record.planId,
      technology: record.technology,
      operatingRegionId: record.operatingRegionId,
      postcode: record.postcode,
      minimumSpeedMbps: record.minimumSpeedMbps,
      maximumSpeedMbps: record.maximumSpeedMbps,
      isActive: record.isActive,
    };
  }
}
