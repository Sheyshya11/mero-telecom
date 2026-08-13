# Mero Telecom ISP Management Platform

Mero Telecom is an academic capstone prototype for managing ISP customers, internet plans,
subscriptions, billing, invoices, and service dashboards.

## Architecture

The repository is a pnpm workspace modular monolith:

- `apps/web` — Next.js frontend using the App Router and Tailwind CSS.
- `apps/api` — NestJS REST API.
- `packages/tsconfig` — shared strict TypeScript base configuration.
- `infrastructure` — reserved for infrastructure assets as the platform grows.

The browser will communicate only with the API; the API will be the future authority for
authentication, authorisation, business rules, and database access.

## Prerequisites

- Node.js 22 or later
- pnpm 11 or later
- Docker Desktop (for PostgreSQL, Redis, and local email capture)

## Local development

1. Copy `.env.example` to `.env` and replace development secrets before using authentication.
2. Install workspace dependencies with `pnpm install`.
3. Start PostgreSQL, Redis, and Mailpit with `pnpm services:up`.
4. Run both applications with `pnpm dev`.

The web app is available at `http://localhost:3000`; the API foundation is available at
`http://localhost:3001/api/v1/health`. Interactive API documentation is available at
`http://localhost:3001/api/docs`.

## Authentication (development)

The API issues a short-lived access token in the login response and a rotated, HTTP-only
`refresh_token` cookie. Send the access token as `Authorization: Bearer <token>` for protected
requests. The development seed accounts and password are listed in the database setup section.

## Role-based access control

The API recognises `ADMIN`, `STAFF`, and `CUSTOMER` roles. Authorization is enforced by backend
guards, not frontend routing. The Phase 5 access-control contract is documented in
`docs/api/authorization.md`; business endpoints added in later phases reuse these guards.

## Customer management

Customer management is available through the secured `/api/v1/customers` endpoints, with search
and pagination. The endpoint contract and role restrictions are documented in
`docs/api/customers.md`.

## Internet plan management

Administrators can create, edit, activate, and deactivate catalogue plans from `/admin/plans`.
The public `/plans` page shows active offerings only. Endpoint access and request details are in
`docs/api/plans.md`.

## Subscription management

Operations staff can assign and manage subscriptions at `/admin/subscriptions`; customers can view
their own subscription history at `/customer/subscription`. The API contract is in
`docs/api/subscriptions.md`.

## Billing and invoices

Administrators and staff can generate a monthly invoice for an active subscription through the
secured invoices API. Amounts are calculated in integer cents from GST-inclusive plan prices; the
invoice API contract and status rules are documented in `docs/api/invoices.md`.

## Invoice PDFs

Users with permission can download invoice PDFs generated from authoritative invoice data. The PDF
delivery endpoint and current storage limitation are documented in `docs/api/invoice-pdf.md`.

## Admin dashboard

Administrators can view current operational metrics at `/admin/dashboard`. The backend aggregation
contract is documented in `docs/api/dashboard.md`.

## Customer dashboard

Customers are taken to `/customer/dashboard` after sign-in. The page shows their own account
details, current plan and subscription, outstanding balance, latest invoice/payment status, and
invoice history. Its server-side summary is ownership-scoped via the authenticated customer account.

## Stripe sandbox payments

Customers can initiate payment for their own issued or overdue invoice from the customer dashboard.
The server creates a Stripe test-mode Checkout Session using authoritative invoice totals. Only a
signature-verified Stripe webhook can persist a successful payment and mark an invoice paid. Add
`STRIPE_SECRET_KEY` (`sk_test_...`) and `STRIPE_WEBHOOK_SECRET` (`whsec_...`) to the API environment
before starting the app; live Stripe keys are rejected at startup.
The local test workflow is documented in `docs/api/payments.md`.

## Invoice email

Administrators and staff can send an invoice PDF through the secured invoice API. Development
messages are redirected to `EMAIL_DEV_RECIPIENT` and captured by Mailpit at
`http://localhost:8025`; they are never sent to seeded customer addresses. SMTP is accessed through
a provider abstraction, and successful delivery attempts are audited and protected against
duplicate sends. Configuration and the acceptance flow are documented in
`docs/api/invoice-email.md`.

## Redis dashboard cache

The admin dashboard summary is cached in Redis with a configurable short TTL. Cache misses run the
authoritative PostgreSQL aggregations, while cache hits avoid repeating those queries. Redis
failures fall back to the database, and cached values expire automatically. The behavior and key
convention are documented in `docs/api/dashboard.md`.

## Verification commands

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

## Continuous integration

GitHub Actions runs the verification suite for every pull request and every push to `main`. The
workflow uses a frozen pnpm lockfile and checks formatting, linting, types, tests, production
builds, the Prisma schema, and high-severity dependency advisories.

## Database setup

After copying `.env.example` to `.env` and starting the local services, run the following from the
repository root:

```text
pnpm --filter @mero-telecom/api prisma:migrate --name init
pnpm --filter @mero-telecom/api prisma:seed
```

The development seed is repeatable and replaces the development data. It provisions the following
demonstration accounts, each with password `ChangeMe123!`:

- `admin@merotelecom.test`
- `staff@merotelecom.test`
- `customer@merotelecom.test`

## Current scope

Phase 17 provides the core customer, plan, subscription, invoice, PDF, dashboards, Stripe sandbox
payment, development invoice-email, Redis admin-dashboard cache, system hardening, and CI
workflows. Deployment preparation and final documentation remain later phases.
