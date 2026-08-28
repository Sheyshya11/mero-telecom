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
    const recovery = application
      .get(ConfigService<AppConfig, true>)
      .getOrThrow('recoverySuperAdmin');
    if (!recovery.email) {
      throw new Error('RECOVERY_SUPER_ADMIN_EMAIL must be configured before running this command.');
    }
    if (recovery.usesLegacyVariable) {
      console.warn('RECOVERY_ADMIN_EMAIL is deprecated; use RECOVERY_SUPER_ADMIN_EMAIL.');
    }
    const result = await application.get(StaffInvitationsService).recoverSuperAdmin(recovery.email);
    console.log(JSON.stringify({ event: 'super_admin_recovery_started', ...result }));
  } finally {
    await application.close();
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'super_admin_recovery_failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }),
  );
  process.exitCode = 1;
});
