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
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
}

export default (): AppConfig => ({
  app: {
    environment: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3001),
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    url: process.env.REDIS_URL ?? '',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
});
