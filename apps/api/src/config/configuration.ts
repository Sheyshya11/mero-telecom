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
    developmentRecipient: string;
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
    };
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
    developmentRecipient: process.env.EMAIL_DEV_RECIPIENT ?? '',
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
    },
  },
});
