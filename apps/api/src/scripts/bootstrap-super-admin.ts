import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import type { AppConfig } from '../config/configuration';
import { StaffInvitationsService } from '../modules/system-users/staff-invitations.service';

async function main(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const bootstrap = application
      .get(ConfigService<AppConfig, true>)
      .getOrThrow('bootstrapSuperAdmin');
    if (!bootstrap.email) {
      throw new Error(
        'BOOTSTRAP_SUPER_ADMIN_EMAIL must be configured before running this command.',
      );
    }
    if (bootstrap.usesLegacyVariables) {
      console.warn(
        'BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_NAME are deprecated; use BOOTSTRAP_SUPER_ADMIN_EMAIL and BOOTSTRAP_SUPER_ADMIN_NAME.',
      );
    }
    const result = await application
      .get(StaffInvitationsService)
      .bootstrapSuperAdmin(bootstrap.email, bootstrap.name);
    console.log(JSON.stringify({ event: 'super_admin_bootstrap_completed', ...result }));
  } finally {
    await application.close();
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'super_admin_bootstrap_failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }),
  );
  process.exitCode = 1;
});
