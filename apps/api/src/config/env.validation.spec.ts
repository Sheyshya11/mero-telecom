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
  SMTP_HOST: 'smtp.example.com',
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
});
