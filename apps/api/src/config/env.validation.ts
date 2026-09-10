import Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3001),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  ADMIN_DASHBOARD_CACHE_TTL_SECONDS: Joi.number().integer().min(5).max(3600).default(60),
  BUSINESS_TIMEZONE: Joi.string().max(100).default('Australia/Adelaide'),
  REFUND_MAX_FILES: Joi.number().integer().min(1).max(20).default(5),
  REFUND_MAX_FILE_SIZE_MB: Joi.number().integer().min(1).max(100).default(10),
  REFUND_MAX_TOTAL_SIZE_MB: Joi.number().integer().min(1).max(200).default(25),
  SUPPORT_MAX_FILES: Joi.number().integer().min(1).max(5).default(3),
  SUPPORT_MAX_FILE_SIZE_MB: Joi.number().integer().min(1).max(25).default(10),
  SUPPORT_MAX_TOTAL_SIZE_MB: Joi.number().integer().min(1).max(50).default(20),
  REFUND_RECONCILIATION_INTERVAL_MS: Joi.number()
    .integer()
    .min(30_000)
    .max(86_400_000)
    .default(300_000),
  REFUND_RECONCILIATION_STALE_AFTER_MINUTES: Joi.number().integer().min(1).max(1440).default(10),
  REFUND_RECONCILIATION_BATCH_SIZE: Joi.number().integer().min(1).max(500).default(50),
  REFUND_ALERT_EMAIL: Joi.string().email().allow('').default(''),
  NBN_PROVIDER: Joi.string().valid('mock').default('mock'),
  NBN_MOCK_SCENARIO: Joi.string()
    .valid('SUCCESS', 'PENDING', 'FAILED', 'MANUAL_REVIEW_REQUIRED')
    .default('PENDING'),
  NBN_MOCK_PENDING_POLLS: Joi.number().integer().min(0).max(100).default(1),
  CANCELLATION_RECONCILIATION_INTERVAL_MS: Joi.number()
    .integer()
    .min(30_000)
    .max(86_400_000)
    .default(60_000),
  CANCELLATION_RECONCILIATION_BATCH_SIZE: Joi.number()
    .integer()
    .min(1)
    .max(500)
    .default(50),
  ADDRESS_LOOKUP_PROVIDER: Joi.string().valid('geoapify').default('geoapify'),
  GEOAPIFY_API_KEY: Joi.when('ADDRESS_LOOKUP_PROVIDER', {
    is: 'geoapify',
    then: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(1).required(),
      otherwise: Joi.string().allow('').default(''),
    }),
  }),
  COVERAGE_QUALIFICATION_PROVIDER: Joi.string().valid('database').default('database'),
  ADDRESS_LOOKUP_MIN_CHARACTERS: Joi.number().integer().min(3).max(10).default(3),
  ADDRESS_LOOKUP_CACHE_TTL_SECONDS: Joi.number().integer().min(30).max(86400).default(600),
  ADDRESS_SELECTION_TTL_SECONDS: Joi.number().integer().min(60).max(3600).default(900),
  PUBLIC_CHECKOUT_CONTEXT_TTL_SECONDS: Joi.number().integer().min(300).max(3600).default(1800),
  THROTTLE_TTL_MS: Joi.number().integer().min(1000).max(3600000).default(60000),
  THROTTLE_LIMIT: Joi.number().integer().min(10).max(10000).default(120),
  ACCOUNT_INVITATION_TTL_HOURS: Joi.number().integer().min(1).max(168).default(24),
  STAFF_INVITATION_TTL_HOURS: Joi.number().integer().min(1).max(168).default(48),
  ENHANCED_AUTH_MAX_AGE_SECONDS: Joi.number().integer().min(300).max(1800).default(600),
  BOOTSTRAP_SUPER_ADMIN_EMAIL: Joi.string().email().max(320).allow('').default(''),
  BOOTSTRAP_SUPER_ADMIN_NAME: Joi.string().trim().max(200).allow('').default(''),
  BOOTSTRAP_ADMIN_EMAIL: Joi.string().email().max(320).allow('').default(''),
  BOOTSTRAP_ADMIN_NAME: Joi.string().trim().max(200).allow('').default(''),
  RECOVERY_SUPER_ADMIN_EMAIL: Joi.string().email().max(320).allow('').default(''),
  RECOVERY_ADMIN_EMAIL: Joi.string().email().max(320).allow('').default(''),
  FRONTEND_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string()
      .uri({ scheme: ['http', 'https'] })
      .required(),
  }),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('7d'),
  JWT_INTERNAL_ACCESS_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('10m'),
  JWT_INTERNAL_REFRESH_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('12h'),
  STRIPE_SECRET_KEY: Joi.string()
    .pattern(/^(?:sk|rk)_test_/)
    .required(),
  STRIPE_WEBHOOK_SECRET: Joi.string()
    .pattern(/^whsec_/)
    .required(),
  EMAIL_FROM: Joi.string().max(320).required(),
  EMAIL_DELIVERY_MODE: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().valid('direct').default('direct'),
    otherwise: Joi.string().valid('redirect', 'direct').default('redirect'),
  }),
  EMAIL_DEV_RECIPIENT: Joi.when('EMAIL_DELIVERY_MODE', {
    is: 'redirect',
    then: Joi.string().email().required(),
    otherwise: Joi.string().email().allow('').optional(),
  }),
  EMAIL_QUEUE_ATTEMPTS: Joi.number().integer().min(1).max(10).default(3),
  EMAIL_QUEUE_BACKOFF_MS: Joi.number().integer().min(100).max(300000).default(3000),
  EMAIL_QUEUE_CONCURRENCY: Joi.number().integer().min(1).max(20).default(3),
  EMAIL_QUEUE_ENCRYPTION_KEY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required(),
    otherwise: Joi.string().min(32).allow('').default(''),
  }),
  SMTP_HOST: Joi.string().hostname().required(),
  SMTP_PORT: Joi.number().port().default(1025),
  SMTP_SECURE: Joi.boolean().truthy('true').falsy('false').default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.when('SMTP_USER', {
    is: '',
    then: Joi.string().allow('').default(''),
    otherwise: Joi.string().min(1).required(),
  }),
  S3_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .default(''),
  S3_REGION: Joi.string().min(2).default('ap-southeast-2'),
  S3_BUCKET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(3).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  S3_ACCESS_KEY_ID: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(3).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  S3_SECRET_ACCESS_KEY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(8).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  S3_FORCE_PATH_STYLE: Joi.boolean().truthy('true').falsy('false').default(false),
});
