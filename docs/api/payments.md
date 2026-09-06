# Stripe sandbox payments

The payment workflow uses Stripe-hosted Checkout in **test mode**. A new visitor can purchase an
available public plan without first having an account. An authenticated customer can select a plan
or pay an owned invoice. In every flow the API resolves price, currency, and ownership from the
database; browser-supplied totals are never trusted.

## Configuration

Set the following backend environment variables with Stripe test credentials only:

```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

The API validates these prefixes at startup and rejects live secret keys. During local development,
forward test events to the API using the Stripe CLI:

```text
stripe listen --forward-to localhost:3001/api/v1/payments/stripe/webhook
```

Copy the CLI-provided `whsec_...` value into `STRIPE_WEBHOOK_SECRET`, restart the API, sign in as the
seeded customer, and pay `INV-2026-000002` using Stripe's standard test card `4242 4242 4242 4242`
with any future expiry, CVC, and postcode.

To exercise self-service plan activation, sign in as `newcustomer@merotelecom.test`, open **My
subscription**, choose a plan, and complete the same test-mode Checkout. The subscription appears
as active after the forwarded paid webhook is processed.

To test new-customer registration, open `/plans`, select a plan, complete `/checkout`, and pay with
the test card. Keep the Stripe CLI listener running. The status page polls the API and can also
reconcile a paid session if the browser returned before a forwarded webhook was processed. Open
Mailpit (or the configured safe development recipient) to follow the account activation link.

## Public registration and checkout

Public checkout does not require login, but it does require a server-trusted service address:

1. `POST /api/v1/coverage/check` consumes the selected-address token and returns a one-use
   `qualificationToken` only for an orderable result.
2. `POST /api/v1/payments/public-checkout-context` consumes that token with a compatible `planId`,
   stores the trusted address/qualification in Redis for 30 minutes, and sets an opaque HTTP-only
   cookie. The token and address are not placed in the checkout URL.
3. `GET /api/v1/payments/public-checkout-context` returns display-safe context fields so checkout
   can restore a landing-page result. A direct `/checkout?planId=...` visit must qualify a service
   address before displaying the applicant form.
4. `POST /api/v1/payments/public-plan-checkout-session` accepts contact data, address relationship
   flags, optional one-use residential/billing address tokens, `planId`, and required consent. It
   never accepts a typed address object, amount, or currency.

The API atomically consumes the HTTP-only context, re-runs database qualification for the exact
trusted service address, confirms the plan remains public/active/orderable, resolves any distinct
residential and billing addresses from Geoapify-backed Redis tokens, and stores normalized address
snapshots in `CheckoutApplication`. "Same as service" and "same as residential" copy only trusted
server-side values. A missing, expired, mismatched, or reused context returns `410` and requires a
fresh coverage check. Redis failure returns `503`; there is no untrusted fallback.

`POST /api/v1/payments/public-checkout-context/clear` deletes the Redis context and clears the
cookie when the visitor changes the installation address. The cookie is `HttpOnly`, path-scoped,
`SameSite=Lax` locally, and `Secure; SameSite=None` for the configured production frontend/API
topology.

After validation, the API stores a short-lived `CheckoutApplication` and creates Stripe Checkout
with the server-side plan price. No `User`, `Customer`, `Subscription`, `Invoice`, or `Payment`
exists at this point.

`GET /api/v1/payments/public-checkout-status?sessionId=cs_test_...` returns only the minimal
application state. It retrieves the Stripe session server-side and safely reconciles a paid session
through the same idempotent fulfilment service used by the webhook. The success URL itself never
activates service.

## Customer-selected plan activation

`POST /api/v1/payments/plan-checkout-session` accepts only a `planId`. The API creates the initial
issued invoice and payment session, but deliberately does not create a subscription yet. A unique
database constraint allows one open plan purchase per customer. Repeated requests reuse the same
open Stripe session, while choosing a different plan expires and cancels the unpaid selection. If
the stored session is already paid, retrying this endpoint reconciles that payment instead of
opening another Checkout or returning a stale conflict.

The authenticated success URL includes Stripe's Checkout Session ID. The customer page calls
`GET /api/v1/payments/checkout-status?sessionId=cs_test_...`; the API first proves that the stored
payment belongs to the signed-in customer, retrieves the session directly from Stripe, and passes
any paid session through the same idempotent invoice/subscription transaction as the webhook. This
is a recovery path for a browser that returns after a local webhook was missed, not a replacement
for the signed webhook.

## Trusted completion and idempotency

The webhook verifies Stripe's signature using the raw request body. Only a verified
`checkout.session.completed` or delayed-method `checkout.session.async_payment_succeeded` event
whose Stripe-reported total and customer/plan metadata match the invoice can change the invoice to
`PAID` and create/update a successful payment. For a plan purchase, that same transaction creates
the `ACTIVE` subscription and links it to the invoice. The payment stores the Stripe Checkout
Session and PaymentIntent identifiers. Each provider event ID is stored in `PaymentWebhookEvent`;
retries become no-ops.

Server-side reconciliation records a deterministic `reconcile:<checkout-session-id>` event marker.
If Stripe later retries the original webhook event, the already-paid payment and active
subscription make that event an idempotent no-op; no second charge, invoice, or subscription is
created.

For a paid public registration, one serializable transaction creates the pending login identity,
customer and addresses, active subscription, paid invoice/items, successful payment, invitation,
webhook record, and audit evidence. The subscription records the paid service immediately while
the account remains `INVITATION_PENDING` until the customer chooses a password. Failed, unpaid,
expired, or abandoned sessions create none of those business records. A paid concurrency conflict
is retained as `REQUIRES_REVIEW` rather than losing payment evidence or attaching it to the wrong
identity.

Residential, service, and billing addresses remain separate. Coverage applies only to the service
address. Editing the eventual customer profile cannot change the address snapshot used by the paid
checkout; moving an active service requires a separate future service-transfer workflow.

The handler also processes `checkout.session.async_payment_failed` and
`checkout.session.expired`. Stripe metadata contains internal identifiers only; personal details
remain in the database. Neither session data nor webhook payloads are logged.

## Refund webhook recovery

Refunds are submitted with an idempotency key derived from the internal refund ID and processing
attempt. Verified `refund.created`, `refund.updated`, and `refund.failed` events are persisted by
provider event ID as part of the same transaction that reconciles the refund and payment. If a webhook is delayed or missed,
the refund reconciliation worker periodically retrieves stale `PROCESSING` refunds directly from
Stripe and applies the same terminal-state reconciliation. Configure the worker with
`REFUND_RECONCILIATION_INTERVAL_MS`, `REFUND_RECONCILIATION_STALE_AFTER_MINUTES`, and
`REFUND_RECONCILIATION_BATCH_SIZE`. Set `REFUND_ALERT_EMAIL` to receive one deduplicated daily
operations alert per affected refund. `GET /api/v1/health/refunds` is suitable for uptime checks
and reports `degraded` while stale processing refunds remain.

Authenticated upgrades reuse this handler with `checkoutKind=plan_change` and collect only the
server-calculated prorated difference. The old subscription remains active until verified payment;
see [subscription plan changes](plan-changes.md) for metadata validation, concurrency, and failure
behaviour.
