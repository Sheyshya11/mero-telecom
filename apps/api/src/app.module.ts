import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { resolve } from 'node:path';

import { AuthorizationModule } from './common/authorization.module';
import configuration from './config/configuration';
import { validationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { AccessControlModule } from './modules/access-control/access-control.module';
import { CustomersModule } from './modules/customers/customers.module';
import { PlansModule } from './modules/plans/plans.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { BillingModule } from './modules/billing/billing.module';
import { CacheModule } from './modules/cache/cache.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { HealthModule } from './health/health.module';
import { CoverageModule } from './modules/coverage/coverage.module';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { AdministrativeAuditInterceptor } from './common/interceptors/administrative-audit.interceptor';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '.env.local'),
        resolve(process.cwd(), '../../.env'),
        resolve(process.cwd(), '../../.env.local'),
        resolve(process.cwd(), 'apps/api/.env'),
        resolve(process.cwd(), 'apps/api/.env.local'),
      ],
      load: [configuration],
      validationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const security = config.getOrThrow('security');
        return [{ ttl: security.throttleTtlMilliseconds, limit: security.throttleLimit }];
      },
    }),
    DatabaseModule,
    CacheModule,
    AuthorizationModule,
    AuthModule,
    AccessControlModule,
    CustomersModule,
    PlansModule,
    SubscriptionsModule,
    BillingModule,
    InvoicesModule,
    DashboardModule,
    PaymentsModule,
    CoverageModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AdministrativeAuditInterceptor },
  ],
})
export class AppModule {}
