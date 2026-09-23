# Subscriptions API

Subscriptions explicitly link a customer to an internet plan and retain prior records as history.
New subscriptions are created as `ACTIVE` only by the verified paid plan-checkout webhook.

| Endpoint                                                         | Access              | Purpose                                                       |
| ---------------------------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `GET /api/v1/subscriptions`                                      | Admin, Staff        | Lists subscription history with pagination.                   |
| `GET /api/v1/subscriptions/:subscriptionId`                      | Admin, Staff, owner | Retrieves one subscription; customers are ownership-filtered. |
| `GET /api/v1/subscriptions/me`                                   | Customer            | Lists the authenticated customer's subscriptions.             |
| `PATCH /api/v1/subscriptions/:subscriptionId`                    | Admin, Staff        | Performs an allowed operational status transition.            |
| `POST /api/v1/subscriptions/:subscriptionId/plan-change/preview` | Customer owner      | Returns the authoritative upgrade/downgrade preview.          |
| `POST /api/v1/subscriptions/:subscriptionId/plan-change`         | Customer owner      | Opens prorated upgrade Checkout or schedules a downgrade.     |
| `GET /api/v1/subscriptions/:subscriptionId/cancellation/preview` | Customer owner      | Previews service end timing and outstanding debt.             |
| `POST /api/v1/subscriptions/:subscriptionId/cancellation`        | Customer owner      | Requests cancellation of a current service.                   |
| `POST /api/v1/subscriptions/:subscriptionId/cancellation/revoke` | Customer owner      | Revokes an unsubmitted future cancellation.                   |
| `POST /api/v1/subscriptions/:subscriptionId/extend-grace-period` | Admin               | Extends overdue grace and termination eligibility together.   |

Allowed staff lifecycle transitions are `PENDING → CANCELLED` (legacy cleanup),
`ACTIVE → SUSPENDED/CANCELLED`, and `SUSPENDED → ACTIVE/CANCELLED`. Staff cannot create or approve
subscriptions. Only one active subscription is allowed for a customer.

Subscriptions also store the agreed monthly price in integer cents, an explicit UTC current billing
period, and a stable day-of-month anchor. Later catalogue price changes do not reprice existing
subscribers. Successful plan changes retain the old row as history and create a new target-plan
subscription with the target price snapshot; the plan is never overwritten in place. See
[subscription plan changes](plan-changes.md).

## Overdue cancellation behaviour

Customers may cancel `ACTIVE`, `PAST_DUE`, or `SUSPENDED` services. Past-due and suspended services
must use immediate cancellation; cancelling service does not cancel, credit, or forgive issued and
overdue invoices. A scheduled cancellation can only be revoked before its effective timestamp and
before submission to the wholesale provider.

While a cancellation is pending, its prior billing lifecycle fields remain intact. If revocation or
provider failure returns the service to operation, the API derives the restored status from current
invoice debt: an overdue service returns to `PAST_DUE` (or remains non-payment `SUSPENDED`), while a
service whose blocking invoices were paid returns to `ACTIVE`. Existing grace extensions and
termination dates are preserved. Failed cancellation retries put the restored service back into
`CANCELLATION_PENDING` before resubmitting the provider operation.

The overdue reconciliation worker also repairs legacy `ACTIVE` subscriptions that already have an
`OVERDUE` invoice. Notification delivery claims are released when enqueueing fails, allowing the
next scheduler run to retry without recording a false sent audit event.
