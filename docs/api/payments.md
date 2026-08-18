# Stripe sandbox payments

The payment workflow uses Stripe-hosted Checkout in **test mode** for a single Mero Telecom invoice. The
browser supplies only an invoice ID; the API resolves ownership, price, currency, and customer email
from the database before creating a Checkout Session.

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

## Trusted completion and idempotency

The webhook verifies Stripe's signature using the raw request body. Only a verified
`checkout.session.completed` event whose Stripe-reported total and customer metadata match the
invoice can change the invoice to `PAID` and create/update a successful payment. The payment stores
the Stripe Checkout Session and PaymentIntent identifiers. Each provider event ID is stored in
`PaymentWebhookEvent`; retries become no-ops, and a second successful session cannot create an
additional successful payment for an already-paid invoice.
