import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, UserStatus } from '@prisma/client';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AdminBootstrapWarningService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapWarningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const activeAdmins = await this.prisma.user.count({
      where: { role: Role.SUPER_ADMIN, status: UserStatus.ACTIVE, isActive: true },
    });
    if (activeAdmins > 0) return;
    const configured = Boolean(this.config.getOrThrow('bootstrapSuperAdmin').email);
    this.logger.warn(
      configured
        ? 'No active super administrator exists. Run pnpm db:bootstrap-super-admin to issue the configured setup invitation.'
        : 'No active super administrator exists and BOOTSTRAP_SUPER_ADMIN_EMAIL is not configured.',
    );
  }
}
