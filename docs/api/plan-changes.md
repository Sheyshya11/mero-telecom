# Subscription plan changes

Mero Telecom manages subscriptions internally and uses Stripe-hosted Checkout only to collect an
upgrade's prorated one-time charge. Stripe Billing subscriptions are not created. The browser never
supplies an authoritative price, credit, currency, period, or payable amount.

## Endpoints and access

| Endpoint                                             | Access                       | Purpose                                                                   |
| ---------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `POST /api/v1/subscriptions/:id/plan-change/preview` | Customer owner               | Revalidates the source and target and returns an itemised server preview. |
| `POST /api/v1/subscriptions/:id/plan-change`         | Customer owner               | Creates or safely resumes an upgrade Checkout, or schedules a downgrade.  |
| `GET /api/v1/subscriptions/:id/plan-change`          | Customer owner               | Returns the latest change for the owned subscription.                     |
| `GET /api/v1/plan-change-requests`                   | Customer, Staff, Admin       | Lists owned requests for a customer; Staff/Admin can filter all requests. |
| `GET /api/v1/plan-change-requests/:id`               | Customer owner, Staff, Admin | Returns safe request, plan, invoice, and payment state.                   |
| `POST /api/v1/plan-change-requests/:id/reconcile`    | Customer owner               | Reconciles a missed paid Checkout using Stripe's server-side state.       |
| `POST /api/v1/plan-change-requests/:id/cancel`       | Customer owner               | Cancels a future scheduled downgrade.                                     |

The preview and request body is only `{ "targetPlanId": "<uuid>" }`. List filters are
`customerId`, `status`, `type`, `effectiveFrom`, `effectiveTo`, `page`, and `limit`. Public
responses intentionally omit Stripe session and Payment Intent identifiers.

## Rules

A change is rejected unless the owned source subscription is active, monthly, and inside a valid
UTC billing period. The target must be a distinct active, available, public plan. Any `ISSUED` or
`OVERDUE` customer invoice blocks the operation, as does another `PENDING`, `CHECKOUT_CREATED`,
`PROCESSING`, or `SCHEDULED` request. A partial unique PostgreSQL index is the final authority for
one in-flight request per source subscription.

Each subscription stores `billingAnchorDay`, `currentPeriodStart`, and `currentPeriodEnd`. The
reconciliation worker advances expired active periods in UTC while preserving the original anchor.
An anchor of 31 is clamped to the last day of a short month and returns to 31 when possible.

## Proration

For each source or target monthly price, where all amounts are integer cents:

```text
prorated = floor((2 × monthlyCents × remainingMilliseconds + periodMilliseconds)
                 / (2 × periodMilliseconds))
amountPayable = max(0, proratedTarget - unusedSourceCredit)
```

This is deterministic integer round-half-up. The implementation uses `BigInt` for multiplication
so price-by-duration cannot lose precision. Source credit and target charge are rounded separately,
then subtracted. A zero-cent validated upgrade applies without creating an invalid zero-value Stripe
Checkout Session.

## Upgrade flow

The API recalculates proration in a serializable transaction, snapshots the plans and billing
period, creates an adjustment invoice, and creates one pending payment. Stripe Checkout receives:

- `checkoutKind=plan_change`
- `planChangeRequestId`
- `sourceSubscriptionId`
- `targetPlanId`

The same identifiers are copied to Payment Intent metadata. Session creation uses the deterministic
idempotency key `plan-change-checkout-<request-id>`. The existing subscription remains active while
Checkout is open. The signature-verified webhook is the primary application path. On the
authenticated Stripe success return—or when **Continue payment** discovers that the stored Session
is already paid—the API may also retrieve that Session directly from Stripe and apply it through
the same validation and idempotent transaction. Browser query parameters alone never apply a
change.
A Stripe API outage returns a retryable `503`; the request remains `PENDING`, its source remains
active, and the customer can use **Continue payment** after connectivity returns.

On a valid paid event, the API checks the session ID, all internal metadata, amount, currency,
current subscription state, target availability/prices, billing-period snapshots, and new invoice
blockers inside a serializable transaction. It then marks the adjustment invoice/payment paid,
cancels the old subscription with historical reason `PLAN_UPGRADE`, and creates the target
subscription immediately with the old period end preserved.

`checkout.session.expired` and `checkout.session.async_payment_failed` cancel the adjustment
invoice, fail the payment/request, and leave the source untouched. A paid event that can no longer
be safely applied records `PAID_PLAN_CHANGE_REQUIRES_REVIEW`; payment evidence is retained but the
source is not ended. `checkout.session.completed` with a delayed payment moves the request to
`PROCESSING`; `checkout.session.async_payment_succeeded` applies it after payment succeeds.

Every Stripe event ID is uniquely stored in the existing `PaymentWebhookEvent` table and linked to
the request. Replays and out-of-order terminal events cannot create another invoice, payment, audit,
email, or subscription.

## Downgrade flow

A cheaper plan creates a `SCHEDULED` request effective at `currentPeriodEnd`, with no Checkout and
no immediate refund. The existing plan stays active. A single-concurrency BullMQ worker runs on
startup and every minute, selects due requests, locks the source subscription, revalidates the
snapshots and blockers, and atomically ends the old subscription with `PLAN_DOWNGRADE`. The new
subscription begins exactly at the boundary and its next month is calculated with the preserved
billing anchor. Normal monthly invoice generation then charges the full target-plan price.

Customers may cancel before the effective timestamp. Reconciliation is safe to retry, and an
optimistic status check plus transaction locking prevents double application.

## Email and audit evidence

BullMQ queues deterministic email jobs for scheduled, applied, cancelled, and failed changes. They
include old/new plans, amount, currency, effective date, next billing date, and the customer
subscription link. Queue payloads remain encrypted and delivery failures retry independently, so an
email outage cannot roll back a completed change.

Audits include request/schedule, Checkout creation, payment completion, application, cancellation,
expiration/failure, paid-needs-review, scheduled reconciliation, billing-period advancement, and
email delivery evidence. Audit metadata contains internal IDs and billing facts, never card data or
raw Stripe payloads.

## Safe local Stripe test

1. Use only `sk_test_...` or `rk_test_...` credentials in the API environment.
2. Start PostgreSQL, Redis, the API, and web app with `pnpm services:up` and `pnpm dev`.
3. Run `stripe listen --forward-to localhost:3001/api/v1/payments/stripe/webhook` and copy its
   `whsec_...` value into the local `STRIPE_WEBHOOK_SECRET`; restart the API.
4. Sign in as a customer with an active, paid-up subscription and open `/customer/subscription`.
5. Select a more expensive plan, inspect the server preview, confirm, and pay using Stripe's test
   card `4242 4242 4242 4242` with any future expiry and CVC.
6. Keep the source active until the CLI prints `checkout.session.completed`; then confirm one old
   historical subscription, one new active subscription, a paid adjustment invoice/payment, and an
   `APPLIED` request in the admin view.
7. Repeat with a cheaper plan, verify no Checkout opens, cancel once, reschedule, and inspect the
   future effective date. For normal testing, let reconciliation apply at the real boundary rather
   than editing database timestamps.
8. Test abandonment by closing an upgrade Checkout. Expiring the test session or forwarding an
   expiration event must leave the source active and mark only the request/payment attempt failed.

The success redirect is informational; it is never accepted as proof of payment.
