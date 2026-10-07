import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

export interface CollectionSettings {
  firstReminderDays: number;
  secondReminderDays: number;
  finalWarningDays: number;
  suspensionDays: number;
}

export function validateCollectionPolicy(policy: CollectionSettings): void {
  const values = [
    policy.firstReminderDays,
    policy.secondReminderDays,
    policy.finalWarningDays,
    policy.suspensionDays,
  ];
  if (
    !values.every((value) => Number.isInteger(value) && value > 0 && value <= 365) ||
    !values.every((value, index) => index === 0 || value > values[index - 1])
  ) {
    throw new BadRequestException(
      'Collection intervals must be positive whole days in strictly increasing order, at most 365 days.',
    );
  }
}

@Injectable()
export class CollectionPolicyService {
  readonly batchSize: number;
  readonly dayMilliseconds: number;
  readonly terminationDays: number;
  private readonly defaults: CollectionSettings;
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    const settings = config.getOrThrow('overdueLifecycle');
    this.dayMilliseconds = settings.dayMilliseconds;
    this.batchSize = settings.batchSize;
    this.terminationDays = settings.terminationDays;
    this.defaults = {
      firstReminderDays: settings.firstReminderDays,
      secondReminderDays: settings.secondReminderDays,
      finalWarningDays: settings.finalWarningDays,
      suspensionDays: settings.gracePeriodDays,
    };
    validateCollectionPolicy(this.defaults);
  }
  async get(
    database: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<CollectionSettings> {
    return (
      (await database.collectionPolicy.findUnique({ where: { id: 'default' } })) ?? this.defaults
    );
  }
  async update(policy: CollectionSettings, actor: AuthenticatedUser) {
    validateCollectionPolicy(policy);
    return this.prisma.$transaction(async (tx) => {
      const previous = await this.get(tx);
      const updated = await tx.collectionPolicy.upsert({
        where: { id: 'default' },
        create: { id: 'default', ...policy },
        update: policy,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'COLLECTION_POLICY_UPDATED',
          entityType: 'CollectionPolicy',
          entityId: 'default',
          metadata: { previous: { ...previous }, policy: { ...policy } },
        },
      });
      return updated;
    });
  }
}
