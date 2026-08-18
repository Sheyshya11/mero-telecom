process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??=
  'postgresql://mero_telecom:mero_telecom_test_password@localhost:5433/mero_telecom_test';
process.env.REDIS_URL ??= 'redis://localhost:6380';
process.env.FRONTEND_URL ??= 'http://localhost:3000';
process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-at-least-thirty-two-characters';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-at-least-thirty-two-characters';
process.env.JWT_ACCESS_EXPIRES_IN ??= '15m';
process.env.JWT_REFRESH_EXPIRES_IN ??= '7d';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_e2e';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_e2e';
process.env.EMAIL_FROM ??= 'Mero Telecom Test <test@example.com>';
process.env.EMAIL_DEV_RECIPIENT ??= 'test@example.com';
process.env.SMTP_HOST ??= 'localhost';
process.env.SMTP_PORT ??= '1025';
process.env.SMTP_SECURE ??= 'false';
process.env.THROTTLE_LIMIT ??= '10000';
