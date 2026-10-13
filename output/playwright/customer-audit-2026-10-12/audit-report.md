# Mero Telecom customer audit

Date: 12 October 2026, Australia/Adelaide.

## Result

The customer screens generally load and the main navigation connects correctly, but several customer actions do not agree with backend rules. The app should not receive an unqualified “everything works together” verdict yet.

No application source was changed. No database reset/reseed, payment submission, refund request, support submission, cancellation or relocation submission was performed. Login/refresh sessions, coverage lookups and a transient guest checkout context were used during inspection. Audit scripts and screenshots live in this directory.

## Findings

### 1. Plan-change invoices use the wrong payment flow

Severity: P2, customer functionality. Confirmed by live screen/API data, source tracing and an isolated service reproduction.

The existing customer account displays `INV-2026-000009`, a `PLAN_CHANGE` invoice, with a “Pay securely with Stripe” action in both the dashboard and invoice history. Its `purchasePlanId` is populated.

`PaymentsService.createCheckoutSession()` routes every invoice with `purchasePlanId` through `createPlanCheckoutSession()`. That flow calls `assertCanPurchasePlan()`, which rejects an existing active subscription. A plan upgrade naturally belongs to a customer who already has a subscription.

An isolated call using mock records and no network/database writes returned HTTP 409:

> You already have a current subscription. Use My subscription to upgrade or downgrade your plan.

The dedicated “Continue payment” control on My Internet is a different flow and was not exercised against Stripe. The finding concerns the generic invoice payment entry points.

Sources: [checkout dispatch](../../../apps/api/src/modules/payments/payments.service.ts#L468), [invoice button](../../../apps/web/src/features/payments/stripe-checkout-button.tsx), [plan-change invoice creation](../../../apps/api/src/modules/plan-changes/plan-changes.service.ts).

Reproduction: [network-free service reproduction](reproduce-invoice-routing.cjs).

### 2. Invoice PDF download fails in the current browser because IDM intercepts it

Severity: P2 for this demonstration environment. Confirmed live. This is a browser integration problem, not a corrupt PDF.

Clicking Download PDF for paid invoice `INV-2026-000002` produced no Playwright download event and changed the control to “Retry PDF”. The browser network record showed:

> GET /api/invoices/me/d8448073-a281-4c8d-9b33-3d80f8cebfc4/pdf — 204 Intercepted by the IDM Advanced Integration

Authenticated requests outside the browser returned HTTP 200 from both the NestJS endpoint and the Next.js proxy. Both returned 20,875 bytes with the `%PDF-` signature. The proxy preserves `Content-Type: application/pdf` and `Content-Disposition: attachment`, allowing the extension to claim the response before the app reads the bytes.

The current invoice flow is therefore not reliable in this browser configuration. No extension setting or download implementation was changed.

Sources: [customer PDF proxy](../../../apps/web/src/app/api/invoices/me/[invoiceId]/pdf/route.ts), [client download handling](../../../apps/web/src/lib/api/client.ts), [Retry PDF display](../../../apps/web/src/features/dashboard/customer-dashboard.tsx#L497).

### 3. Refund eligibility differs between the UI and backend

Severity: P2, customer functionality. Confirmed by live data/UI and isolated policy execution.

The refund page offers an enabled “Request refund” action for `INV-2026-000001`. Its successful payment has provider `MANUAL` and reference `DEMO-MANUAL-000001`.

The frontend checks successful/partially-refunded status, remaining refundable amount and whether a request already exists. It does not check the payment provider. The backend only accepts completed Stripe payments with a provider payment reference.

The isolated policy check returned HTTP 409 with code `REFUND_PAYMENT_NOT_PAID` and message:

> Only a completed Stripe payment can be refunded.

The customer can therefore enter a refund form for a payment the backend will reject. No refund request was submitted.

Sources: [UI eligibility](../../../apps/web/src/features/refunds/customer-refunds.tsx#L179), [backend policy](../../../apps/api/src/modules/refunds/refund-policy.service.ts#L20).

Reproduction: [network-free eligibility checks](reproduce-eligibility.cjs). Screenshot: [refund page](customer_refunds.png).

### 4. The current demo customer's billing state is stale and inconsistent

Severity: P2 for demo readiness. Confirmed live; distinguish existing data from a newly introduced code regression.

On 12 October 2026, the dashboard labels 1 October 2026 as the “Next payment” under “Upcoming billing”. My Internet and the cancellation form show a current billing period of 1 September–1 October.

The automatic-payment setup backend rejects this exact expired-period condition with HTTP 409:

> The current billing period has ended. Refresh and try again.

The frontend nevertheless offers “Enable automatic payments” without explaining the expired-period prerequisite. The source computes the dashboard's next billing date directly from `currentPeriodEnd`.

The same account's $0.19 upgrade invoice is stored as OVERDUE despite a due date of 14 October 2026. This is another existing data inconsistency; the audit did not determine which earlier operation wrote that status.

The account is not a clean current-period demonstration checkpoint. Repairing or replacing this demo scenario needs a deliberate follow-up, not a blanket database reseed.

Sources: [next-payment date](../../../apps/api/src/modules/dashboard/dashboard.service.ts#L1145), [recurring setup prerequisites](../../../apps/api/src/modules/payments/payments.service.ts), [subscription screen](../../../apps/web/src/app/customer/subscription/page.tsx).

### 5. “Remember me on this device” has no effect

Severity: P3, misleading authentication option. Confirmed by source inspection and session behavior.

The login checkbox is a standalone input. It is not registered in the login form, read in the submit handler or passed to authentication. The login function accepts only email and password. Customer refresh-cookie behavior is therefore the same with or without this choice.

Sources: [checkbox](../../../apps/web/src/app/login/page.tsx#L148), [authentication provider](../../../apps/web/src/features/auth/auth-provider.tsx).

### 6. The prefilled demo mobile number fails the profile validator

Severity: P3, demo data/validation mismatch. Confirmed by live field value and schema inspection, not by submitting an update.

The customer profile contains `0400 000 001`, including spaces. The profile schema requires a compact Australian mobile number such as `0400000001`.

Changing an unrelated address field and submitting the entire form would fail the mobile validation until the existing phone number is corrected. No profile change was submitted. This is primarily a compatibility problem between current demo data and the form validator.

Sources: [profile schema](../../../apps/web/src/features/customers/customer-profile.tsx#L16). Screenshot: [profile](customer_profile.png).

## Verification coverage

| Customer area | Checked today | Boundary |
| --- | --- | --- |
| Public coverage | Live autocomplete, recognised selection, AVAILABLE/FTTP result, compatible plans | Database estimate only; no live NBN qualification |
| Signup entry | Family 100 and the selected service address carried into guest checkout | Stopped before Continue to secure payment |
| Login/session | Documented demo account login, restored sessions across routes | Remember-me defect noted |
| Access boundary | Customer visiting employee dashboard returned to customer dashboard | Existing backend guards also covered by unit suites |
| Customer overview | Live service, balances, latest invoice and pending-upgrade activity | Stale date/data noted |
| My Internet | Active manual service, pending upgrade, recurring setup entry, credit-history empty state | Stripe setup and card-management actions not executed |
| Invoices | Live history, status display, PDF action, local API/proxy bytes | Browser IDM interference and payment-routing defect noted |
| Support | Live list, filters and request form opening | Submission, attachment upload and employee reply not exercised today |
| Refunds | Live payment/history lists and request form opening | No request, approval or settlement; provider mismatch noted |
| Moving Home | Live address wizard entry and existing-request lookup | No submitted move, qualification-to-submission or provider operation |
| Cancellation | Existing-status lookup, preview GET and initial wizard | No cancellation or withdrawal submitted |
| Profile/email | Live profile and email-change forms, schema/backend review | No contact, email or password changes |
| Security | Password-change form and requirements display | No password mutation |
| Notifications | Live bell/count/history and filter controls | The account has no notifications; read/delete and event generation not exercised |

The six additional customer screens inspected by the screen-audit harness produced no uncaught browser page errors. Developer-mode image warnings were observed and were not treated as functional failures.

## Automated verification

- Frontend: 40 files passed, 200 tests passed.
- Backend: 78 suites passed, 605 tests passed.
- Total: 805 existing tests passed.
- Existing isolated PostgreSQL/Redis end-to-end suites were not run. No reset-based test command was used.
- Two isolated diagnostic scripts reproduce invoice-routing and eligibility failures with mocks. They contain no live Stripe client, HTTP calls or database writes.

Passing component and service tests does not establish that every complete customer workflow succeeds against external integrations.

## Remaining live-payment check

Automatic approval review rejected initiating the invoice Pay action because checkout-session creation could export customer/invoice details to Stripe and create payment state. The rejected browser command did not execute. No alternative live call was used to bypass that decision.

Payment routing was instead diagnosed with source tracing and a network-free reproduction. Full live Stripe test checkout, webhook return and post-payment customer state remain unverified in this audit and require approval before execution.

## Recommended next step

Review the findings before authorizing fixes. Prioritise the plan-change payment entry point, refund eligibility and the PDF behavior in the demonstration browser. Then prepare current-period demo records and resolve the smaller login/profile inconsistencies. No fixes have been applied.
