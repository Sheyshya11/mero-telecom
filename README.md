# Mero Telecom ISP Management Platform

Mero Telecom is an academic full-stack prototype for operating a small Australian internet
service provider. It centralises customer records, plan and subscription administration,
GST-inclusive invoicing, private invoice documents, test-mode payments, invoice email, coverage
checks, and role-specific dashboards.

## Delivered scope

- Public plan catalogue and postcode coverage checker.
- Short-lived JWT access tokens, rotating HTTP-only refresh cookies, and server-side revocation.
- Backend-enforced `ADMIN`, `STAFF`, and `CUSTOMER` permissions with customer ownership checks.
- Customer, internet-plan, and subscription management.
- Deterministic monthly billing in integer cents, with GST-inclusive invoice calculations.
- Authoritative invoice PDFs stored privately in production and streamed only after authorization.
- Stripe test-mode Checkout with signature-verified, idempotent webhook processing.
- Invoice email through SMTP, with development messages redirected to Mailpit.
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

PostgreSQL is authoritative. Redis is used only for short-lived dashboard caching. Stripe, SMTP,
and S3-compatible object storage are accessed only by the API. See the
[system architecture](docs/architecture/system-architecture.md) and [database ERD](docs/database/erd.md).

## Prerequisites

- Node.js 22 or later
- pnpm 11 or later
- Docker Desktop
- Stripe test-mode secret and webhook signing secret

## Local development

1. Copy `.env.example` to `.env` and replace every placeholder secret.
2. Install dependencies with `pnpm install`.
3. Start PostgreSQL, Redis, and Mailpit with `pnpm services:up`.
4. Apply migrations and seed safe demonstration data:

   ```text
   pnpm --filter @mero-telecom/api exec prisma migrate deploy
   pnpm --filter @mero-telecom/api prisma:seed
   ```

5. Start both applications with `pnpm dev`.

The frontend is at `http://localhost:3000`, the API health endpoint is at
`http://localhost:3001/api/v1/health`, Swagger UI is at `http://localhost:3001/api/docs`, and
Mailpit is at `http://localhost:8025`.

Local object storage is optional: when S3 settings are empty outside production, PDFs are rendered
on demand without persistence. Production configuration requires private S3-compatible storage.

## Demonstration accounts

The repeatable development seed creates these accounts with password `ChangeMe123!`:

- `admin@merotelecom.test`
- `staff@merotelecom.test`
- `customer@merotelecom.test`

Never run the development seed or reuse these credentials in production.

## Main application routes

| Audience | Routes                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------- |
| Public   | `/`, `/plans`, `/coverage`, `/login`                                                              |
| Admin    | `/admin/dashboard`, `/admin/customers`, `/admin/plans`, `/admin/subscriptions`, `/admin/invoices` |
| Staff    | `/staff/customers`                                                                                |
| Customer | `/customer/dashboard`, `/customer/profile`, `/customer/subscription`, `/customer/invoices`        |

The browser UI is a convenience boundary only; NestJS guards and ownership-scoped queries enforce
all access decisions.

## Billing and Stripe flow

An admin or staff member assigns an active plan and generates one invoice per subscription and
issue date. The API derives the amount from the stored plan, extracts the GST component using
integer arithmetic, and persists the invoice and line item in one transaction. Customers can
start Stripe Checkout only for their own issued or overdue invoices. A valid
`checkout.session.completed` webhook creates or updates the payment and marks the invoice paid;
the browser cannot mark an invoice paid directly.

Stripe is deliberately restricted to test keys (`sk_test_...` or `rk_test_...`). Full details are
in [payments](docs/api/payments.md).

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
- [API overview and RBAC matrix](docs/api/README.md)
- [Database design and ERD](docs/database/erd.md)
- [Testing strategy](docs/testing/testing-strategy.md)
- [Deployment and rollback](docs/deployment.md)
- [Limitations and future improvements](docs/limitations.md)
