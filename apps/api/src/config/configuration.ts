export interface AppConfig {
  app: {
    environment: string;
    port: number;
    frontendUrl: string;
  };
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  cache: {
    adminDashboardTtlSeconds: number;
  };
  addressLookup: {
    provider: 'geoapify';
    geoapifyApiKey: string;
    minimumCharacters: number;
    cacheTtlSeconds: number;
    selectionTtlSeconds: number;
    requestTimeoutMilliseconds: number;
  };
  coverage: {
    qualificationProvider: 'database';
  };
  publicCheckout: {
    contextTtlSeconds: number;
  };
  security: {
    throttleTtlMilliseconds: number;
    throttleLimit: number;
    accountInvitationTtlHours: number;
    staffInvitationTtlHours: number;
    enhancedAuthMaxAgeSeconds: number;
  };
  bootstrapSuperAdmin: {
    email: string;
    name: string;
    usesLegacyVariables: boolean;
  };
  recoverySuperAdmin: {
    email: string;
    usesLegacyVariable: boolean;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  stripe: {
    secretKey: string;
    webhookSecret: string;
  };
  email: {
    from: string;
    deliveryMode: 'redirect' | 'direct';
    developmentRecipient: string;
    queue: {
      name: string;
      attempts: number;
      backoffMilliseconds: number;
      concurrency: number;
      encryptionKey: string;
    };
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
    };
  };
  storage: {
    enabled: boolean;
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
}

export default (): AppConfig => ({
  app: {
    environment: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3001),
    frontendUrl: new URL(process.env.FRONTEND_URL ?? 'http://localhost:3000').origin,
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    url: process.env.REDIS_URL ?? '',
  },
  cache: {
    adminDashboardTtlSeconds: Number(process.env.ADMIN_DASHBOARD_CACHE_TTL_SECONDS ?? 60),
  },
  addressLookup: {
    provider: (process.env.ADDRESS_LOOKUP_PROVIDER ?? 'geoapify') as 'geoapify',
    geoapifyApiKey: process.env.GEOAPIFY_API_KEY ?? '',
    minimumCharacters: Number(process.env.ADDRESS_LOOKUP_MIN_CHARACTERS ?? 3),
    cacheTtlSeconds: Number(process.env.ADDRESS_LOOKUP_CACHE_TTL_SECONDS ?? 600),
    selectionTtlSeconds: Number(process.env.ADDRESS_SELECTION_TTL_SECONDS ?? 900),
    requestTimeoutMilliseconds: 5_000,
  },
  coverage: {
    qualificationProvider: (process.env.COVERAGE_QUALIFICATION_PROVIDER ??
      'database') as 'database',
  },
  publicCheckout: {
    contextTtlSeconds: Number(process.env.PUBLIC_CHECKOUT_CONTEXT_TTL_SECONDS ?? 1800),
  },
  security: {
    throttleTtlMilliseconds: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
    throttleLimit: Number(process.env.THROTTLE_LIMIT ?? 120),
    accountInvitationTtlHours: Number(process.env.ACCOUNT_INVITATION_TTL_HOURS ?? 24),
    staffInvitationTtlHours: Number(process.env.STAFF_INVITATION_TTL_HOURS ?? 48),
    enhancedAuthMaxAgeSeconds: Number(process.env.ENHANCED_AUTH_MAX_AGE_SECONDS ?? 600),
  },
  bootstrapSuperAdmin: {
    email:
      process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ||
      process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ||
      '',
    name:
      process.env.BOOTSTRAP_SUPER_ADMIN_NAME?.trim() ||
      process.env.BOOTSTRAP_ADMIN_NAME?.trim() ||
      'Mero Telecom Super Administrator',
    usesLegacyVariables:
      !process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim() &&
      Boolean(process.env.BOOTSTRAP_ADMIN_EMAIL?.trim()),
  },
  recoverySuperAdmin: {
    email:
      process.env.RECOVERY_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ||
      process.env.RECOVERY_ADMIN_EMAIL?.trim().toLowerCase() ||
      '',
    usesLegacyVariable:
      !process.env.RECOVERY_SUPER_ADMIN_EMAIL?.trim() &&
      Boolean(process.env.RECOVERY_ADMIN_EMAIL?.trim()),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  },
  email: {
    from: process.env.EMAIL_FROM ?? '',
    deliveryMode:
      process.env.EMAIL_DELIVERY_MODE === 'direct' || process.env.NODE_ENV === 'production'
        ? 'direct'
        : 'redirect',
    developmentRecipient: process.env.EMAIL_DEV_RECIPIENT ?? '',
    queue: {
      name: 'mero-telecom-email',
      attempts: Number(process.env.EMAIL_QUEUE_ATTEMPTS ?? 3),
      backoffMilliseconds: Number(process.env.EMAIL_QUEUE_BACKOFF_MS ?? 3_000),
      concurrency: Number(process.env.EMAIL_QUEUE_CONCURRENCY ?? 3),
      encryptionKey: process.env.EMAIL_QUEUE_ENCRYPTION_KEY ?? '',
    },
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
    },
  },
  storage: {
    enabled: Boolean(
      process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
    ),
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'ap-southeast-2',
    bucket: process.env.S3_BUCKET ?? '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  },
});
