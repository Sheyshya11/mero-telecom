# Billing reporting definitions

Mero Telecom billing reports use Australian dollars, integer cents, and the configured reporting timezone (`Australia/Adelaide` by default). Calendar-date filters are converted from local midnight to UTC, including daylight-saving changes. API period ends are exclusive; the selected end date itself is included.

## Event sources and timing

The existing issued Invoice, settled Payment, completed Refund, applied PlanChangeRequest, PaymentWebhookEvent, and AuditLog records are the reporting/audit event sources. They remain the operational sources of truth. A second financial ledger was deliberately not added because it would require risky dual writes and duplicate the existing immutable transaction records.

Period metrics describe activity within the selected local reporting period. Snapshot metrics describe state at the period end.

## Metric definitions

- **Gross billed:** sum of `Invoice.totalCents` for valid invoices issued during the period. Draft and cancelled invoices are excluded. This is GST-inclusive.
- **Payments received:** sum of settled Payment amounts with `paidAt` inside the period. Settled statuses are `SUCCEEDED`, `PARTIALLY_REFUNDED`, and `REFUNDED`; later refunds do not erase the original cash receipt.
- **Outstanding:** valid invoice total less settled payments received before the report end. For legacy/manual flows that have no linked Payment row, an `Invoice.paidAt` timestamp before the snapshot is treated as authoritative settlement evidence. It is an as-at snapshot, not limited to invoices created during the period.
- **Refunds paid:** sum of Refund amounts with `SUCCEEDED` status and `processedAt` inside the period.
- **Credits issued:** sum of positive `unusedCreditCents` on applied plan changes whose `appliedAt` is inside the period. These are non-cash adjustments.
- **Net cash collected:** `payments received - refunds paid`. Credits are not deducted. A period can be negative when a current-period refund relates to an older payment.
- **Net billed:** `gross billed - credits issued`. This is kept separate from cash collection.
- **GST billed:** sum of tax recorded on invoices issued in the period.
- **GST associated with collected payments:** invoice GST allocated proportionally to settled payment amounts received in the period.
- **GST refunded or credited:** invoice GST allocated proportionally to completed refunds, plus the GST component of GST-inclusive applied credits.
- **MRR:** GST-exclusive monthly-equivalent plan price for services active as at period end. Current plans are monthly. Future quarterly and annual cycles must be normalised by 3 and 12 respectively before inclusion.
- **Active services:** paid subscriptions active as at period end. Pending, suspended, and already-ended services are excluded.
- **ARPU:** `MRR / active paid services`; zero when no active services exist.
- **Overdue balance:** outstanding invoice balances where the due date is before the snapshot date.
- **Receivables ageing:** outstanding amounts bucketed by due date into Current, 1–30, 31–60, 61–90, and 90+ days overdue.
- **Payment success rate:** `successful finalised attempts / (successful + failed finalised attempts) × 100`. Pending attempts are excluded.
- **Reconciliation status:** read-only checks against recorded Stripe identifiers and signed webhook evidence. `MATCHED` means local state and recorded evidence agree; `MISMATCH`, `MISSING_EXTERNAL`, and `NEEDS_REVIEW` are operational exceptions.

Recognised/service revenue is not currently reported because the system does not yet store daily service-delivery recognition or deferral schedules. It must not be inferred from cash collection.

## Reconciliation scope

The report does not call Stripe while a page is being viewed and never repairs financial records. It checks local transactions against the Stripe IDs and idempotent webhook-event evidence already stored by webhook processing. A future scheduled reconciliation job may store provider-side amount, currency, fee, settlement, and balance-transaction snapshots for deeper matching.

Stripe webhook processing remains authoritative: signatures are verified against the raw request body, provider event IDs are unique, and payment/invoice/subscription/refund changes occur transactionally. A Checkout success return is not authoritative.

## Credits and profitability

Refunds are cash movements; plan-change credits are non-cash adjustments and are always reported separately. Wholesale network cost and payment-processing fee data are not configured, so gross contribution and gross margin are returned as unavailable rather than estimated.

## Exports

CSV, XLSX, and PDF exports invoke the same report methods and filters as the dashboard. They include the organisation, report, reporting period, timezone, generated timestamp, generating user, and active filters.
