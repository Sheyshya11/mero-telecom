# Testing strategy

## Objectives

Testing is organized around the highest-risk boundaries: authentication/session rotation,
role/ownership authorization, deterministic billing, integration side effects, schema migrations,
and production builds. Unit tests isolate calculations and adapters; the end-to-end suite boots the
real NestJS application against dedicated PostgreSQL and Redis instances.

## Test layers

| Layer            | Command                                           | What it proves                                                                |
| ---------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Formatting       | `pnpm format:check`                               | Version-controlled source and docs match Prettier                             |
| Lint             | `pnpm lint`                                       | ESLint rules and common unsafe patterns pass                                  |
| Types            | `pnpm typecheck`                                  | Strict TypeScript contracts across workspaces                                 |
| Unit/integration | `pnpm test`                                       | API services/adapters plus Vitest coverage-component behavior                 |
| API end-to-end   | `pnpm test:e2e`                                   | Real routes, guards, migrations, PostgreSQL transactions, and Redis readiness |
| Production build | `pnpm build`                                      | NestJS and Next.js compile in production mode                                 |
| Schema           | `pnpm --filter @mero-telecom/api prisma:validate` | Prisma schema and datasource contract are valid                               |
| Supply chain     | `pnpm audit --audit-level=high`                   | No known high/critical dependency advisory is accepted silently               |

## Isolated test infrastructure

`pnpm services:test:up` starts `postgres-test` on port `5433` and `redis-test` on port `6380`.
Both use temporary in-memory Docker filesystems and distinct credentials from development. The
root `test:e2e` script injects only these URLs. Before every run, Prisma resets the test schema and
applies all committed migrations without generating a new client, producing a deterministic empty
database.

This isolation is intentional: the end-to-end suite never points to the development database on
port `5432`, and it does not run the demonstration seed.

## End-to-end acceptance coverage

The API suite verifies:

- rejected credentials, successful login, refresh rotation, old-cookie replay rejection, logout,
  and revoked-session rejection;
- role boundaries for admin, staff, and customer users;
- customer uniqueness/validation and staff restrictions on protected fields;
- passwordless admin customer creation, invitation replacement, token activation/replay rejection,
  and login only after activation;
- enumeration-safe password-reset requests, token hashing/expiry/replacement/replay rejection,
  Redis email/IP limits, session revocation, and role/status preservation for customer, staff,
  admin, super-admin, and suspended accounts;
- public checkout rejection for an existing identity, with no duplicate customer account;
- active plan, subscription, and invoice creation through HTTP;
- deterministic GST cents, duplicate monthly invoice conflict, and authorized PDF bytes;
- customer ownership on records and PDFs, including an IDOR attempt;
- self-service mass-assignment rejection;
- authoritative upgrade/downgrade preview, ownership, blocking invoices, conflicting requests,
  cancellation, historical subscription creation, and future renewal invoicing;
- invalid Stripe signatures and plan-change metadata, amount/currency mismatch, duplicate and
  out-of-order webhooks, expiration, asynchronous failure, suspension/overdue races, and exactly-once
  upgrade/downgrade application;
- PostgreSQL and Redis readiness; mocked autocomplete with Redis-backed one-time selections;
  exact available/unsupported/coming-soon/override/state decisions; management RBAC; analytics;
  HTTP-only guest checkout context issuance/restoration/one-use consumption; trusted address
  persistence; and administrative audit evidence.

External systems are not contacted in this suite. Stripe cryptographic/event behavior, SMTP email
composition/deduplication, private object-storage behavior, Redis cache fallback, PDF rendering,
guards, and configuration validation are exercised with focused tests and injected fakes.

Frontend Vitest/Testing Library checks prove forgot-password acknowledgement, reset-link
validation, password matching, and successful reset navigation, plus the three-character threshold, 400 ms debounce,
keyboard selection, loading/safe provider errors, selection requirement, result clearing on input
change, compatible-plan actions, and available/coming-soon/outside/manual-review rendering. Guest
checkout tests cover a direct visit that cannot proceed without qualification, landing-page
context restoration, and distinct residential/billing tokens without browser-posted address
objects.

Email queue tests prove that recipient data, activation tokens, and reset tokens are not visible in Redis job
payloads, deterministic IDs prevent duplicate enqueueing, exponential retry settings are applied,
valid invitations record SMTP delivery evidence, and revoked invitations are skipped. The E2E
suite waits for the fake SMTP worker to mark an invitation sent, covering NestJS, BullMQ, Redis,
and PostgreSQL together without contacting Gmail.

Focused Stripe tests also prove that the public amount comes from the selected plan, no customer is
created before payment, paid webhook retries create exactly one account/subscription, and expired
Checkout creates no account or service. Invitation tests assert token hashing, expiry, replacement,
strong password hashing, successful activation, and replay rejection.

## Browser acceptance

Before a release, run the application with migrated/seeded development services and exercise:

1. Public home, plans, and coverage results.
2. Admin login, dashboard, invoice management, safe cancellation dialog, and PDF download.
3. Staff login and restricted customer-management navigation.
4. Customer login, owned dashboard/invoice history, PDF download, and profile update form.
5. Customer plan-change upgrade preview, Stripe redirect, pending state, scheduled downgrade, and
   cancellation; confirm the admin plan-change filters show the same records.
6. Browser console and network failures during each journey.

Use test data only. Do not submit a real payment or email a real customer. Stripe Checkout may be
tested with official sandbox cards and a Stripe CLI-forwarded, signature-verified webhook.

## CI policy

GitHub Actions runs on every pull request and push to `main`. It installs from the frozen lockfile,
generates Prisma Client, launches clean PostgreSQL/Redis service containers, and runs the entire
verification sequence. Third-party actions are pinned to immutable commit SHAs. A pull request is
not releasable until the `Verify` job is green.

## Release evidence and triage

Record the commit SHA, CI run URL, migration result, deployed health/readiness responses, and smoke
test date for each production release. When a failure occurs, preserve the first failing command
and its log, reproduce it locally against isolated services, fix the underlying cause, and rerun
the full sequence rather than only the previously failing command.
