import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
    HealthModule,
  ],
})
export class AppModule {}
