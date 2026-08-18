# API overview

The NestJS API is served under `/api/v1`. Interactive OpenAPI documentation is available at
`/api/docs` and the generated document at `/api/docs-json` while the service is running.

JSON endpoints use the global validation pipe: values are transformed to DTO types, required
constraints are enforced, and unrecognized fields are rejected. Errors have a stable HTTP status
and normalized JSON shape. Protected endpoints expect `Authorization: Bearer <access-token>`;
refresh and logout use the HTTP-only `refresh_token` cookie.

## Endpoint and role summary

| Area                      | Public             | Customer                   | Staff                 | Admin                    |
| ------------------------- | ------------------ | -------------------------- | --------------------- | ------------------------ |
| Health and readiness      | Read               | Read                       | Read                  | Read                     |
| Coverage and active plans | Read               | Read                       | Read                  | Read                     |
| Login / refresh / logout  | Session owner      | Session owner              | Session owner         | Session owner            |
| Customer collection       | —                  | —                          | Read/update           | Create/read/update       |
| Own customer profile      | —                  | Read/update allowed fields | —                     | —                        |
| Plan administration       | —                  | —                          | —                     | Create/update/deactivate |
| Subscription collection   | —                  | Own records                | Create/read/update    | Create/read/update       |
| Invoices                  | —                  | Own records/PDF/pay        | Create/read/PDF/email | Full workflow/status     |
| Dashboards                | —                  | Own summary                | —                     | Aggregate summary        |
| Stripe webhook            | Signature required | Signature required         | Signature required    | Signature required       |

The public webhook row does not mean anonymous callers are trusted: raw request bytes and the
`Stripe-Signature` header must pass cryptographic verification before any data changes.

## Route catalogue

- `/health`, `/health/ready` — liveness and dependency readiness.
- `/coverage` — public prototype postcode lookup; see [coverage](coverage.md).
- `/plans/public`, `/plans` — public catalogue and protected plan management; see [plans](plans.md).
- `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` — authentication lifecycle.
- `/customers`, `/customers/me` — operations and self-service customer data.
- `/subscriptions`, `/subscriptions/me` — assignment and customer history.
- `/invoices`, `/invoices/me`, `/invoices/generate`, `/invoices/:id/pdf`,
  `/invoices/:id/send`, `/invoices/:id/status` — invoice workflow.
- `/payments/checkout-session`, `/payments/stripe/webhook` — Stripe test-mode payments.
- `/dashboard/admin`, `/dashboard/customer` — role-specific summaries.

Feature-specific request bodies, filters, state transitions, and response examples are documented
in the other files in this directory. Database-level uniqueness and transaction boundaries remain
the final protection against duplicate invoice, payment, and webhook processing.

## Authentication and error expectations

- Access tokens expire after the configured short lifetime (15 minutes by default).
- Refresh cookies rotate on every successful refresh. Reusing the previous cookie returns `401`.
- A refresh call without a cookie is a no-op response so an anonymous frontend bootstrap does not
  generate a console error; a supplied invalid or expired cookie still returns `401`.
- Role or ownership violations return `403`; missing records return `404`; conflicting uniqueness
  or state transitions return `409`; invalid payloads return `400`.
- Login is limited to 10 attempts per minute, refresh to 30 per minute, coverage to 30 per minute,
  and other endpoints inherit the configurable global throttle.

## Private document delivery

Production PDFs are stored in a private S3-compatible bucket and addressed by an internal
`InvoiceDocument` record. No public object URL is returned. The API checks the invoice role and
ownership before reading or rendering the document and streams it with a private cache policy. The
Next.js `/api/invoices/:id/pdf` route is only a same-origin transport proxy for browser downloads.
