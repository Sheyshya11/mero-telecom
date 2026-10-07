# Mero Telecom — Eight Real Test Cases

Executed 6 October 2026 UTC / 7 October 2026 in Australia/Adelaide.

30 live API/database assertions passed. Seven assignment cases passed within their stated scope; relocation is a partial pass.

These PNG files were captured from the running application in a real Chrome browser. The application used a fresh isolated PostgreSQL database, Redis, real Geoapify address suggestions, and Stripe sandbox checkout/webhooks. Local test emails were routed to Mailpit. The screenshots have not been recreated or edited.

Extract the ZIP and open index.html to browse all screenshots. Individual full-resolution PNG files are organised into TC01–TC08 folders.

## Results

### TC01 — Authentication and Role Access (PASS)

Signed in as Customer, Staff, Admin and Super Admin and captured the correct dashboards. A customer visiting an admin page returned to the customer dashboard. Live API checks rejected invalid credentials (401), denied customer/staff access to administrative user management (403), and restricted security audit logs to Super Admin (Admin 403, Super Admin 200).

Screenshots:

- [TC01-a-customer-dashboard.png](TC01/TC01-a-customer-dashboard.png)
- [TC01-b-staff-dashboard.png](TC01/TC01-b-staff-dashboard.png)
- [TC01-c-admin-dashboard.png](TC01/TC01-c-admin-dashboard.png)
- [TC01-d-super-admin-dashboard.png](TC01/TC01-d-super-admin-dashboard.png)

### TC02 — Coverage Checking (PASS)

Selected recognised addresses and performed real coverage checks: 100 King William Street, Adelaide SA 5000 returned AVAILABLE with FTTP and compatible plans; 15 King William Street, Rosewater SA 5013 returned NOT_AVAILABLE. This verifies configured database estimates; it does not establish live NBN serviceability.

Screenshots:

- [TC02-a-supported-coverage.png](TC02/TC02-a-supported-coverage.png)
- [TC02-b-unsupported-coverage.png](TC02/TC02-b-unsupported-coverage.png)

### TC03 — Subscription and Payment (PASS)

Maya selected Family 100 and completed the actual hosted Stripe sandbox checkout with a 4242 test card. The application received signed Stripe webhook events, recorded an AUD79.00 succeeded payment and paid invoice INV-2026-000004, and displayed the subscription as Active with automatic payments. The same subscription was subsequently used for TC05, changing its final status to CANCELLATION_PENDING.

Screenshots:

- [TC03-a-plan-selection.png](TC03/TC03-a-plan-selection.png)
- [TC03-b-stripe-sandbox-checkout.png](TC03/TC03-b-stripe-sandbox-checkout.png)
- [TC03-c-paid-active-subscription.png](TC03/TC03-c-paid-active-subscription.png)

### TC04 — Duplicate Monthly Invoice Prevention (PASS)

Generated October invoice INV-2026-000005 for Anika. The UI then displayed October 2026 invoice already exists and replaced generation with View invoice. Two concurrent API requests for 6 and 19 October returned the same invoice with generationResult EXISTING; database count stayed at exactly one invoice for that subscription and October period.

Screenshots:

- [TC04-duplicate-october-invoice-prevented.png](TC04/TC04-duplicate-october-invoice-prevented.png)

### TC05 — Cancellation and Refund Review (PASS)

Submitted a refund request for the sandbox payment, started administrative review, and confirmed UNDER_REVIEW on both employee and customer screens. Submitted cancellation CAN-2026-00001, approved it, and scheduled it for 7 November 2026. Stripe sandbox cancellation-at-period-end synchronised; the subscription is CANCELLATION_PENDING with no end date yet. Refund payout and physical network disconnection were outside this request-and-review test.

Screenshots:

- [TC05-b-cancellation-awaiting-review.png](TC05/TC05-b-cancellation-awaiting-review.png)
- [TC05-c-administrative-refund-review.png](TC05/TC05-c-administrative-refund-review.png)
- [TC05-d-administrative-cancellation-review.png](TC05/TC05-d-administrative-cancellation-review.png)
- [TC05-e-customer-refund-under-review.png](TC05/TC05-e-customer-refund-under-review.png)

### TC06 — Service Relocation (PARTIAL PASS)

Taylor submitted a move from 15 to 100 King William Street, Adelaide, kept Essential 50, and selected 10 October 2026. Employee review approved and scheduled the request. Database qualification was AVAILABLE and the original subscription/address stayed active. The provider is MOCK_MNF: live NBN/MNF provisioning, physical activation and old-service disconnection were not tested.

Screenshots:

- [TC06-a-customer-relocation-request.png](TC06/TC06-a-customer-relocation-request.png)
- [TC06-b-administrative-relocation-monitoring.png](TC06/TC06-b-administrative-relocation-monitoring.png)

### TC07 — Ticket Escalation (PASS)

Created support case SUP-2026-00001. Staff raised linked internal request IR-2026-00001; Admin took ownership, started review and escalated it to Super Admin; Super Admin took ownership. Persisted audit events confirm the same request moved from ADMIN to SUPER_ADMIN with the support link and role ownership retained. Resolution was not part of the escalation test.

Screenshots:

- [TC07-a-staff-to-admin-request.png](TC07/TC07-a-staff-to-admin-request.png)
- [TC07-b-admin-to-super-admin.png](TC07/TC07-b-admin-to-super-admin.png)
- [TC07-c-super-admin-review.png](TC07/TC07-c-super-admin-review.png)

### TC08 — Notifications (PASS)

Real billing, refund, cancellation, relocation and escalation actions generated in-app notifications for the relevant users. Captured employee and customer lists, marked a customer notification read in the browser, and confirmed the read state persisted. The API returned only the logged-in customer records and rejected another user changing that notification (404).

Screenshots:

- [TC08-a-super-admin-event-notifications.png](TC08/TC08-a-super-admin-event-notifications.png)
- [TC08-b-customer-billing-refund-notifications.png](TC08/TC08-b-customer-billing-refund-notifications.png)
- [TC08-c-notification-marked-read.png](TC08/TC08-c-notification-marked-read.png)

## Verification files

- real-test-results.json: sanitised final API/database assertions, coverage results, and notification recipients.
- live-api-verification.txt: readable final assertion output.
- screenshot-manifest.json: capture times, file sizes and SHA-256 hashes.
- supporting-unit-test-results.json: 170 passing existing Jest unit/service checks with mocked dependencies, supplemental to the real workflows.

TC03 was captured before TC05 changed that customer’s subscription lifecycle. The Active checkout screenshot and cancellation’s recorded subscriptionStatusBefore=ACTIVE preserve that sequence. Coverage and relocation are database estimates; network-provider results are simulated. TC05 verifies request/review/scheduling, not refund settlement or live disconnection.