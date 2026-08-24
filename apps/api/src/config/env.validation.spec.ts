import { validationSchema } from './env.validation';

const validEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@database:5432/mero_telecom',
  REDIS_URL: 'redis://redis:6379',
  FRONTEND_URL: 'https://app.example.com',
  JWT_ACCESS_SECRET: 'access-secret-at-least-thirty-two-characters',
  JWT_REFRESH_SECRET: 'refresh-secret-at-least-thirty-two-characters',
  STRIPE_SECRET_KEY: 'rk_test_example',
  STRIPE_WEBHOOK_SECRET: 'whsec_example',
  EMAIL_FROM: 'billing@example.com',
  EMAIL_QUEUE_ENCRYPTION_KEY: 'production-email-queue-key-at-least-32-characters',
  SMTP_HOST: 'smtp.example.com',
  S3_BUCKET: 'mero-telecom-invoices',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
};

describe('environment validation', () => {
  it('accepts an HTTPS frontend origin in production', () => {
    expect(validationSchema.validate(validEnvironment).error).toBeUndefined();
  });

  it('rejects an insecure frontend origin in production', () => {
    const { error } = validationSchema.validate({
      ...validEnvironment,
      FRONTEND_URL: 'http://app.example.com',
    });

    expect(error?.details.some(({ path }) => path.join('.') === 'FRONTEND_URL')).toBe(true);
  });

  it('allows localhost HTTP for development', () => {
    const { error } = validationSchema.validate({
      ...validEnvironment,
      NODE_ENV: 'development',
      FRONTEND_URL: 'http://localhost:3000',
      EMAIL_DEV_RECIPIENT: 'developer@example.com',
    });

    expect(error).toBeUndefined();
  });

  it('allows direct Gmail SMTP delivery without a development redirect address', () => {
    const { error, value } = validationSchema.validate({
      ...validEnvironment,
      NODE_ENV: 'development',
      FRONTEND_URL: 'http://localhost:3000',
      EMAIL_FROM: 'Mero Telecom <sender@gmail.com>',
      EMAIL_DELIVERY_MODE: 'direct',
      EMAIL_DEV_RECIPIENT: '',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: 465,
      SMTP_SECURE: true,
      SMTP_USER: 'sender@gmail.com',
      SMTP_PASS: 'google-app-password',
    });

    expect(error).toBeUndefined();
    expect(value.EMAIL_DELIVERY_MODE).toBe('direct');
  });

  it('requires an SMTP password whenever SMTP authentication is configured', () => {
    const { error } = validationSchema.validate({
      ...validEnvironment,
      SMTP_USER: 'sender@gmail.com',
      SMTP_PASS: '',
    });

    expect(error?.details.some(({ path }) => path.join('.') === 'SMTP_PASS')).toBe(true);
  });
});
