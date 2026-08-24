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

`POST /api/v1/payments/public-plan-checkout-session` accepts applicant/contact data, typed
residential/service/billing addresses, `planId`, and required terms/privacy consent flags. It does
not accept an amount or currency. The API rejects an existing account email, unavailable plan, or
uncovered service postcode, then stores a short-lived `CheckoutApplication` and creates Stripe
Checkout with the server-side plan price. No `User`, `Customer`, `Subscription`, `Invoice`, or
`Payment` exists at this point.

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

The handler also processes `checkout.session.async_payment_failed` and
`checkout.session.expired`. Stripe metadata contains internal identifiers only; personal details
remain in the database. Neither session data nor webhook payloads are logged.

Authenticated upgrades reuse this handler with `checkoutKind=plan_change` and collect only the
server-calculated prorated difference. The old subscription remains active until verified payment;
see [subscription plan changes](plan-changes.md) for metadata validation, concurrency, and failure
behaviour.
