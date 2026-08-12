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
- Docker Desktop (for PostgreSQL and Redis)

## Local development

1. Copy `.env.example` to `.env` and replace development secrets before using authentication.
2. Install workspace dependencies with `pnpm install`.
3. Start PostgreSQL and Redis with `pnpm services:up`.
4. Run both applications with `pnpm dev`.

The web app is available at `http://localhost:3000`; the API foundation is available at
`http://localhost:3001`.

## Verification commands

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

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

Phase 2 establishes Prisma, the initial PostgreSQL schema, its first migration, and demonstration
data. API configuration, authentication, business modules, Swagger, and database access services
remain deferred to later phases.
