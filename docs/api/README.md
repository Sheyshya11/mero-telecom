# API overview

The NestJS API is served under `/api/v1`. Interactive OpenAPI documentation is available at
`/api/docs` and the generated document at `/api/docs-json` while the service is running.

JSON endpoints use the global validation pipe: values are transformed to DTO types, required
constraints are enforced, and unrecognized fields are rejected. Errors have a stable HTTP status
and normalized JSON shape. Protected endpoints expect `Authorization: Bearer <access-token>`;
refresh and logout use the HTTP-only `refresh_token` cookie.

## Endpoint and role summary

| Area                     | Public             | Customer                           | Staff                               | Admin                               |
| ------------------------ | ------------------ | ---------------------------------- | ----------------------------------- | ----------------------------------- |
| Health and readiness     | Read               | Read                               | Read                                | Read                                |
| Address coverage         | Check              | Check                              | Check/view config                   | Check/full configuration            |
| Active plans             | Read               | Read                               | Read                                | Read/administer                     |
| Login / refresh / logout | Session owner      | Session owner                      | Session owner                       | Session owner                       |
| Customer collection      | —                  | —                                  | Read/update                         | Create/read/update                  |
| Own customer profile     | —                  | Read/update allowed fields         | —                                   | —                                   |
| Plan administration      | —                  | —                                  | —                                   | Create/update/deactivate            |
| Subscription collection  | —                  | Own records/select/pay/change plan | Read/status and plan-change history | Read/status and plan-change history |
| Invoices                 | —                  | Own records/PDF/pay                | Create/read/PDF/email               | Full workflow/status                |
| Dashboards               | —                  | Own summary                        | —                                   | Aggregate summary                   |
| Stripe webhook           | Signature required | Signature required                 | Signature required                  | Signature required                  |

The public webhook row does not mean anonymous callers are trusted: raw request bytes and the
`Stripe-Signature` header must pass cryptographic verification before any data changes.

## Route catalogue

- `/health`, `/health/ready` — liveness and dependency readiness.
- `/coverage/address-suggestions`, `/coverage/check` — public trusted-address lookup, exact
  database qualification, and one-use checkout qualification tokens; see [coverage](coverage.md).
- `/coverage-management/*` — Admin configuration/analytics and Staff read-only views.
- `/plans/public`, `/plans` — public catalogue and protected plan management; see [plans](plans.md).
- `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` — authentication lifecycle.
- `/auth/forgot-password`, `/auth/reset-password/validate`, `/auth/reset-password` —
  enumeration-safe, rate-limited, single-use password recovery for eligible local accounts.
- `/customers`, `/customers/me` — operations and self-service customer data.
- `/subscriptions`, `/subscriptions/me` — operational status management and customer history.
- `/subscriptions/:id/plan-change/*`, `/plan-change-requests` — owned upgrade/downgrade previews,
  requests, cancellation, and role-filtered history; see [plan changes](plan-changes.md).
- `/invoices`, `/invoices/me`, `/invoices/generate`, `/invoices/:id/pdf`,
  `/invoices/:id/send`, `/invoices/:id/status` — invoice workflow.
- `/payments/public-checkout-context`, `/payments/public-checkout-context/clear`,
  `/payments/public-plan-checkout-session`, `/payments/public-checkout-status`,
  `/payments/plan-checkout-session`, `/payments/checkout-session`, `/payments/stripe/webhook` —
  public registration, customer plan purchase, and Stripe test-mode payments.
- `/auth/activation/verify`, `/auth/activation`, `/auth/activation/resend` — single-use account
  invitation verification, password setup, and enumeration-safe resend.
- `/dashboard/admin`, `/dashboard/customer` — role-specific summaries.

Feature-specific request bodies, filters, state transitions, and response examples are documented
in the other files in this directory. Database-level uniqueness and transaction boundaries remain
the final protection against duplicate invoice, payment, and webhook processing.

## Authentication and error expectations

- Access tokens expire after the configured short lifetime (15 minutes by default).
- Refresh cookies rotate on every successful refresh. Reusing the previous cookie returns `401`.
- Password-reset links expire after 30 minutes. Completing a reset revokes every refresh session
  without changing the account role, status, or activation state. `ACTIVE` and `SUSPENDED` users
  may reset; invited users must activate, and deactivated users require administrative recovery.
- A refresh call without a cookie is a no-op response so an anonymous frontend bootstrap does not
  generate a console error; a supplied invalid or expired cookie still returns `401`.
- Role or ownership violations return `403`; missing records return `404`; conflicting uniqueness
  or state transitions return `409`; invalid payloads return `400`.
- Login is limited to 10 attempts per minute, refresh to 30 per minute, coverage to 20 per minute,
  and other endpoints inherit the configurable global throttle.
- Forgot-password requests additionally use Redis counters: three requests per normalized email
  per 30 minutes and five requests per source IP per 15 minutes. Redis unavailability fails closed.

## Private document delivery

Production PDFs are stored in a private S3-compatible bucket and addressed by an internal
`InvoiceDocument` record. No public object URL is returned. The API checks the invoice role and
ownership before reading or rendering the document and streams it with a private cache policy. The
Next.js `/api/invoices/:id/pdf` route is only a same-origin transport proxy for browser downloads.
