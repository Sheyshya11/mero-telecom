# Stripe recurring billing

Stripe owns recurring charge execution, saved payment methods, recurring invoices, retries, and the Stripe subscription state. Mero Telecom mirrors those events into its `Subscription`, `Invoice`, `Payment`, audit, overdue, and service-provisioning records.

## Test-mode setup

1. In Stripe test mode, create one Product per internet plan and one active monthly AUD Price for each Product.
2. In Admin → Plans, store the matching `price_...` ID before publishing a plan. The API verifies that its amount, currency, active state, and monthly interval match the Mero Telecom plan.
3. Create a Customer Portal configuration that allows payment-method and invoice management but disables subscription cancellation and plan changes. Set its `bpc_...` ID in `STRIPE_PORTAL_CONFIGURATION_ID`. Mero Telecom opens the portal in Stripe's dedicated payment-method-update flow and redirects straight back to the subscription page.
4. Configure the webhook endpoint as `POST /payments/stripe/webhook` and subscribe to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.updated`
   - `payment_method.attached`
   - `payment_method.updated`
   - `payment_method.detached`
   - the existing refund events
5. Store the restricted test API key and webhook signing secret in the deployment secret store. Never commit them.

For the demo seed, the three optional `STRIPE_PRICE_*` variables populate the Price mapping. Existing seeded subscriptions remain `MANUAL`; sign in as that customer and use **Enable automatic payments** to demonstrate the migration path without charging the already-paid period twice.

## Demo and renewal testing

- New signup: choose a plan, complete Checkout with test card `4242 4242 4242 4242`, and verify that the customer, active local subscription, Stripe subscription, paid invoice, payment, next billing date, and masked card appear.
- New-customer card persistence: completion resolves the reusable payment method from the Stripe subscription, with the paid invoice PaymentIntent as a fallback, then idempotently sets both the Stripe Customer and subscription defaults before activating the local subscription.
- Existing customer: use **Enable automatic payments**. Checkout runs in setup mode; Mero Telecom creates a Stripe subscription with a trial ending at the already-paid local period boundary, so the first automatic charge occurs on the next billing date.
- Renewal: use a Stripe test clock for the Stripe Customer, advance it past the subscription item period end, and verify one new `STRIPE_RECURRING` invoice and one payment locally. Re-send the same `invoice.paid` event and confirm no duplicates.
- Failure: use Stripe's recurring-payment failure test method, advance the test clock, and verify the mirrored invoice becomes overdue, the subscription enters the existing past-due/grace lifecycle, and the Customer Portal action is available.
- Payment-method recovery: from **My subscription**, add a new test card or open the Stripe Customer Portal. Mero Telecom makes the selected card the Customer and subscription default, then asks Stripe to retry the same open invoice. The later `invoice.paid` webhook updates the existing local invoice/payment; it does not create a replacement invoice.
- Removal safeguards: a customer with an active, past-due, suspended, cancellation-pending, or disconnection-pending recurring subscription cannot remove its only card. A default card must be replaced before it can be detached. Removing a card never cancels a subscription.
- Webhook idempotency: re-send `customer.updated`, `payment_method.attached`, `payment_method.updated`, and `payment_method.detached` events and confirm each provider event ID creates at most one synchronization/audit result.
- Cancellation: request end-of-period cancellation in Mero Telecom and verify `cancel_at_period_end` in Stripe. Revoking the request clears it. Immediate cancellation cancels Stripe immediately and continues through the existing ISP disconnection workflow.
- Plan change: upgrades update the existing Stripe subscription item with Stripe proration/payment handling. Downgrades set the next recurring Price without proration and apply the local service-plan change at the existing period boundary.

Stripe Tax is intentionally not enabled by this change. Before enabling `automatic_tax`, configure the required tax registrations and product tax codes in Stripe.
