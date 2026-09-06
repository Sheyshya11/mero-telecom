# Mero Telecom ISP Management Platform

Mero Telecom is an academic full-stack prototype for operating a small Australian internet
service provider. It centralises customer records, plan and subscription administration,
GST-inclusive invoicing, private invoice documents, test-mode payments, invoice email, coverage
checks, and role-specific dashboards.

## Delivered scope

- Public plan catalogue and trusted Australian address coverage checker.
- Server-side Geoapify autocomplete with Redis selection tokens, exact database qualification,
  compatible-plan rules, SA-first configuration, and Admin/Staff coverage operations.
- Short-lived JWT access tokens, rotating HTTP-only refresh cookies, and server-side revocation.
- Backend-enforced `ADMIN`, `STAFF`, and `CUSTOMER` permissions with customer ownership checks.
- Customer, internet-plan, and subscription management.
- Deterministic monthly billing in integer cents, with GST-inclusive invoice calculations.
- Authoritative invoice PDFs stored privately in production and streamed only after authorization.
- Stripe test-mode Checkout with signature-verified, idempotent webhook processing.
- Self-service prorated upgrades and boundary-scheduled downgrades with historical subscriptions.
- Public customer registration through paid Checkout, followed by a single-use account activation
  link; abandoned or failed payments never create login accounts.
- Guest coverage follows the selected plan into Checkout through an HTTP-only Redis context;
  service, residential, and billing addresses may differ but are all server-trusted selections.
- Invitation-based admin customer creation without staff-generated passwords.
- Redis-backed account and payment email with encrypted queue payloads, exponential retry, SMTP
  delivery evidence, and development routing to Mailpit or dynamic Gmail recipients.
- Admin and customer dashboards, Redis caching, readiness checks, throttling, structured request
  logs, and administrative audit records.

The prototype does not provision network services, perform credit checks, collect production
payments, or replace an accounting platform. See [limitations](docs/limitations.md).

## Architecture

This repository is a pnpm workspace and modular monolith:

- `apps/web` — Next.js App Router frontend and narrow same-origin PDF proxy.
- `apps/api` — NestJS REST API and all authorization/business rules.
- `apps/api/prisma` — PostgreSQL schema and forward-only migrations.
- `packages/tsconfig` — shared strict TypeScript configuration.
- `docs` — architecture, API, database, testing, and deployment runbooks.

PostgreSQL is authoritative. Redis provides short-lived dashboard caching and the durable BullMQ
email queue. Stripe, SMTP, and S3-compatible object storage are accessed only by the API. See the
[system architecture](docs/architecture/system-architecture.md) and [database ERD](docs/database/erd.md).

## Prerequisites

- Node.js 22 or later
- pnpm 11 or later
- Docker Desktop
- Stripe test-mode secret and webhook signing secret

## Local development

1. Copy `.env.example` to `.env`, replace every placeholder secret, and add a development
   `GEOAPIFY_API_KEY`.
2. Install dependencies with `pnpm install`.
3. Start PostgreSQL, Redis, and Mailpit with `pnpm services:up`.
4. Apply migrations and seed development demonstration data:

   ```text
   pnpm db:migrate
   pnpm db:seed:demo
   ```

5. Start both applications with `pnpm dev`.

The frontend is at `http://localhost:3000`, the API health endpoint is at
`http://localhost:3001/api/v1/health`, Swagger UI is at `http://localhost:3001/api/docs`, and
Mailpit is at `http://localhost:8025`.

Local object storage is optional: when S3 settings are empty outside production, PDFs are rendered
on demand and refund attachments are kept in the ignored private `.private/refund-attachments`
directory. Production configuration requires private S3-compatible storage. Attachment limits are
configured with `REFUND_MAX_FILES`, `REFUND_MAX_FILE_SIZE_MB`, and `REFUND_MAX_TOTAL_SIZE_MB`.

Local email supports two explicit modes. `EMAIL_DELIVERY_MODE=redirect` safely sends all messages
to `EMAIL_DEV_RECIPIENT`. `EMAIL_DELIVERY_MODE=direct` sends activation, payment, and invoice email
to the address entered by the customer. Direct Gmail testing uses `smtp.gmail.com`, SSL port 465,
the full Gmail address as `SMTP_USER`, and a Google App Password as `SMTP_PASS`; the normal Google
account password must never be used or committed.

Activation and subscription-confirmation messages are queued with deterministic IDs and retried
with exponential backoff. Their recipient, content, and activation URLs are AES-256-GCM encrypted
before entering Redis. Manual invoice PDF delivery stays synchronous so the admin receives an
authoritative sent/already-sent result and a provider message ID.

## Demonstration accounts

The repeatable development seed creates these accounts with password `ChangeMe123!`:

- `admin@merotelecom.test`
- `staff@merotelecom.test`
- `customer@merotelecom.test`
- `newcustomer@merotelecom.test` (no subscription; use this account to demonstrate self-service plan checkout)

Never run the development seed or reuse these credentials in production.

## Main application routes

| Audience | Routes                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public   | `/`, `/plans`, `/coverage`, `/checkout`, `/activate`, `/activate/resend`, `/staff-invitation`, `/login`                                                |
| Admin    | `/admin/dashboard`, `/admin/customers`, `/admin/plans`, `/admin/subscriptions`, `/admin/invoices`, `/admin/refunds`, `/admin/coverage`, `/admin/users` |
| Staff    | `/staff/customers`, `/staff/coverage`, `/staff/refunds`                                                                                                |
| Customer | `/customer/dashboard`, `/customer/profile`, `/customer/subscription`, `/customer/invoices`, `/customer/refunds`                                        |

The browser UI is a convenience boundary only; NestJS guards and ownership-scoped queries enforce
all access decisions.

Production and staging must use `pnpm db:migrate` followed by the one-time, idempotent
`pnpm db:bootstrap-super-admin`; they must not use the development seed. Super administrators
invite administrators from `/admin/users`, while administrators can invite staff. See
[system-user provisioning](docs/api/system-users.md).

## Billing and Stripe flow

New visitors select and qualify a service address before Stripe Checkout. An opaque HTTP-only
cookie carries only a random Redis context identifier into guest checkout, where the customer may
mark residential and billing addresses as the same or select different normalized addresses. The
API revalidates the exact service address and chosen plan, derives the amount from the stored plan,
and rejects browser-posted address objects. No user, customer, invoice, or subscription is created
until a valid paid Checkout webhook arrives. The webhook then records the three address roles,
paid invoice, payment, active subscription, pending customer account, and single-use activation
invitation in one idempotent transaction. Existing customers sign in before changing plans or
paying an owned invoice.

Stripe is deliberately restricted to test keys (`sk_test_...` or `rk_test_...`). Full details are
in [payments](docs/api/payments.md). Upgrade, downgrade, reconciliation, and safe test procedures
are documented in [subscription plan changes](docs/api/plan-changes.md).

Refund webhooks are accepted at `/api/v1/payments/stripe/webhook`. In local development, run
`stripe listen --forward-to http://127.0.0.1:3001/api/v1/payments/stripe/webhook` and set the
printed `whsec_...` value as `STRIPE_WEBHOOK_SECRET`. Production must configure the same route as
a public HTTPS endpoint in Stripe Dashboard. Refund event IDs and Stripe idempotency keys are
persisted to prevent duplicate processing. A BullMQ reconciliation worker also re-checks stale
`PROCESSING` refunds directly with Stripe; configure its interval and alert address with
`REFUND_RECONCILIATION_INTERVAL_MS`, `REFUND_RECONCILIATION_STALE_AFTER_MINUTES`,
`REFUND_RECONCILIATION_BATCH_SIZE`, and `REFUND_ALERT_EMAIL`. Monitoring systems can poll
`GET /api/v1/health/refunds`, which reports a `degraded` status when stale refunds exist.

## Verification

Run the isolated PostgreSQL and Redis test services before the end-to-end suite:

```text
pnpm services:test:up
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm --filter @mero-telecom/api prisma:validate
pnpm audit --audit-level=high
pnpm services:test:down
```

The [testing strategy](docs/testing/testing-strategy.md) describes test isolation and the covered
security and business workflows. GitHub Actions repeats this verification with clean PostgreSQL
and Redis services on pull requests and pushes to `main`.

## Deployment

The prepared production topology uses Vercel for the Next.js frontend and a Render Blueprint for
the API, PostgreSQL, and Redis. Render runs migrations before traffic reaches a new release, and
the API readiness endpoint checks both datastores. Private S3-compatible storage, SMTP, Stripe
test-mode credentials, provider sign-in, and billing approval must be supplied by the project
owner. Follow the [deployment runbook](docs/deployment.md); do not run the seed in production.

## Documentation index

- [System architecture](docs/architecture/system-architecture.md)
- [Requirements UML diagrams](docs/architecture/requirements-uml.md)
- [Address lookup and coverage qualification](docs/api/coverage.md)
- [API overview and RBAC matrix](docs/api/README.md)
- [Database design and ERD](docs/database/erd.md)
- [Testing strategy](docs/testing/testing-strategy.md)
- [Deployment and rollback](docs/deployment.md)
- [Limitations and future improvements](docs/limitations.md)
