# Employee review for cancellation and moving home

Implemented in the existing cancellation, relocation, NotificationService, audit, dashboard and provider architecture. No replacement workflow, notification system or refund module was introduced.

## Cancellation state flow

```text
Customer submits existing type, reason, comments and acknowledgement
  -> PENDING_REVIEW (subscription/service/billing unchanged)
     -> REJECTED (customer-safe reason; service unchanged)
     -> REVOKED (customer withdraws before review; service unchanged)
     -> reviewDecision=APPROVED
        -> REQUESTED (immediate, approved and ready to process)
        -> SCHEDULED (end of current billing period at approval)
           -> PROCESSING -> DISCONNECTION_PENDING if provider is pending
              -> COMPLETED (subscription CANCELLED after provider success)
              -> FAILED (existing operational investigation/retry path)
```

`APPROVED` is a recorded review decision, not a duplicate operational status. The existing `REQUESTED` operational status now means an approved immediate cancellation ready for processing. Approval, scheduling and completion remain distinct.

Submission stores a read-only refund estimate; it creates no refund and makes no Stripe/provider call. Approval recalculates the estimate using the current period and approval time and reserves an eligible refund through the existing refund service. The existing automatic refund processing runs only after wholesale termination succeeds. End-of-period requests retain the existing cancellation/revocation behavior after approval.

The customer form now says **Submit Cancellation Request**, explains employee review and continuing billing, displays **Awaiting review**, shows the customer-safe rejection reason, and permits another request after rejection. The employee drawer shows plan, monthly price, subscription state, latest invoice, reason/comments, refund context, decision, reviewer, timestamp and private notes.

## Relocation state flow

```text
Customer selects trusted qualified address, plan, move date, billing address and comments
  -> PENDING_REVIEW (current subscription and both active addresses unchanged)
     -> REJECTED (customer-safe reason; service unchanged)
     -> CANCELLED (reversible customer withdrawal; service unchanged)
     -> reviewDecision=APPROVED
        -> CONFIRMED (approved and ready for immediate provisioning)
        -> SCHEDULED (future requested move date)
           -> PROVISIONING
              -> FAILED (existing operational retry/escalation)
              -> PARTIALLY_COMPLETED (new service actually activated)
                 -> COMPLETED (old-service disconnection succeeds)
                 -> existing manual review/retry/escalation when disconnection fails
```

No duplicate `APPROVED` operational status was added. The former customer `/confirm` path is an employee-only approval alias, and the customer UI no longer calls it.

The requested billing address is stored on the request. It becomes the customer's billing address only when the new service is actually activated. Existing subscription plan, price and authoritative service-address changes also remain at that activation stage. A move is not completed while the old-service disconnection is outstanding.

A missing legacy authoritative service-address pointer is left unchanged during submission; the old premises are captured as an internal request snapshot. Coverage remains explicitly **DATABASE_ESTIMATE**, and the provider remains **SIMULATED**. The reviewer can see current/new premises, current/requested plans, move/disconnection dates, service and billing state, qualification source/technology, comments and operational history.

## Permissions and existing hierarchy

| Role        | Review                                                                                                                | Existing later operations                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer    | Submit and view owned requests; withdraw while reversible. Cannot approve, reject, or use the old confirmation route. | Existing ownership and withdrawal restrictions apply.                                                                                                                                                    |
| Staff       | List/view cancellation and relocation requests, approve/reject pending requests, add internal notes.                  | Does not gain Admin cancellation retries/revocation, relocation retries/rescheduling/demo controls, or Super Admin overrides.                                                                            |
| Admin       | Same initial review rights.                                                                                           | Existing cancellation creation/retry/revocation and relocation cancellation/retry/reschedule/demo/escalation rights remain. Rescheduling a pending request changes requested dates without approving it. |
| Super Admin | Same initial review rights through the existing hierarchy.                                                            | Inherits Admin rights and retains relocation escalation-resolution/override privileges. An override cannot bypass the approval boundary.                                                                 |

There is one reviewer per request. No blanket two-level approval was introduced. JWT authentication, existing route role guards and a service-level employee reviewer check protect the decision endpoints. Rejection requires a trimmed customer-safe reason of 3-2000 characters; internal notes are separate and optional, with a 2000-character limit. Customers never receive internal review notes or reviewer identity.

## Notifications and action queues

All notifications use the existing central NotificationService and existing BullMQ email queue.

| Event                   | Customer                                                                                                 | Employees                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Cancellation submitted  | `CANCELLATION_REQUESTED`, INFO, awaiting review                                                          | `CANCELLATION_REVIEW_REQUIRED`, ACTION_REQUIRED, Staff/Admin/Super Admin |
| Cancellation approved   | `CANCELLATION_APPROVED`, INFO                                                                            | Initial review notification resolved after the decision commits          |
| Cancellation scheduled  | `CANCELLATION_SCHEDULED`, WARNING                                                                        | Existing operational behavior                                            |
| Cancellation rejected   | `CANCELLATION_REJECTED`, INFO, safe reason on owned request                                              | Initial review notification resolved                                     |
| Cancellation completed  | `SUBSCRIPTION_CANCELLED`, INFO                                                                           | Existing failure/operational alerts retained                             |
| Move submitted          | `RELOCATION_REQUESTED`, INFO, awaiting review                                                            | `RELOCATION_REVIEW_REQUIRED`, ACTION_REQUIRED, Staff/Admin/Super Admin   |
| Move approved/scheduled | Existing `RELOCATION_PROVISIONING`, INFO, or existing installation-required notification when applicable | Initial review notification resolved after the decision commits          |
| Move rejected           | `RELOCATION_REJECTED`, INFO, safe reason on owned request                                                | Initial review notification resolved                                     |
| Move completed          | `RELOCATION_COMPLETED`, SUCCESS                                                                          | Existing failure/operational alerts retained                             |

A scheduled move notification says provisioning is scheduled. After actual new-service activation, it says the new address is active and completion still awaits old-service disconnection. Completion notifications are sent only by the corresponding completion paths. Mock cancellation completion emails retain the existing explicit simulation wording.

Customer links open the existing subscription/moving-home pages. Employee cancellation links select the request in the existing management drawer; relocation links open its existing detail page. Reading a notification never changes a request's review state. Withdrawal also resolves the review notifications.

Staff, Admin and Super Admin dashboards now share an **Action required** section backed by actual pending request counts, independent of unread notifications. Cancellation and move links filter existing management pages to `PENDING_REVIEW`. The refund count/link uses the existing initial `REQUESTED` refund queue; the refund review implementation was preserved.

Existing database notification deduplication and stable email job IDs prevent duplicate submission/review notifications. Cancellation requested/approved/rejected and relocation requested/rejected email jobs retain their deduplication records after completion instead of expiring them with ordinary transient mail.

## Side-effect protection and concurrency

- Both create methods explicitly persist `PENDING_REVIEW` and avoid subscription mutations, billing-address updates, Stripe cancellation, provider provisioning/disconnection and refund reservation.
- Cancellation scheduling reconciliation, processing claims and provider-result application require recorded approval. Stripe synchronization checks approval and records its synchronization timestamp. A committed approved request can be recovered by existing reconciliation after an interrupted request handler.
- Relocation scheduling reconciliation, provisioning/disconnection claims, provider-result application, retry/qualification/demo paths and Super Admin overrides require approval. Provider claims lock the subscription and reload current request state before acting.
- Review decisions run in serializable transactions under the existing subscription lock. They reload the request and conditionally update its pending status, empty decision and version. A conflicting decision returns HTTP 409; same-decision retries return the original result and preserve the original reviewer/reason/notes without repeating processing or notification dispatch.
- Serializable database conflicts retry a bounded number of times before returning a review conflict. Pending relocation withdrawal and rescheduling use the same locking/retry boundary, preventing them from overwriting a concurrent review decision.
- Existing unique partial indexes now include pending requests, preventing two open requests of the same type per subscription. Existing plan-change/cancellation/relocation conflict checks recognize pending review. Rejected requests are terminal and no longer block later service or collection workflows.

## Audit

The durable request record stores decision, reviewer user ID, reviewed time, internal notes and customer-safe rejection reason. Transactional audit records include the actor and decision context/private review notes.

Cancellation events: `CANCELLATION_REQUESTED`, **`CANCELLATION_APPROVED`**, **`CANCELLATION_REJECTED`**, `CANCELLATION_SCHEDULED`, `CANCELLATION_COMPLETED`, and existing revocation, Stripe, provider and refund events.

Relocation events: `RELOCATION_REQUESTED`, **`RELOCATION_APPROVED`**, **`RELOCATION_REJECTED`**, **`RELOCATION_STARTED`**, `NEW_SERVICE_ACTIVATED`, `OLD_SERVICE_DISCONNECTED`, `RELOCATION_COMPLETED`, and existing qualification, retry, note, scheduling, escalation and override events. `CUSTOMER_BILLING_ADDRESS_UPDATED` now occurs at actual activation, rather than submission.

## Migrations and legacy requests

Two additive migrations were deployed to the existing local development and test databases:

- `20261001110000_service_request_review_schema`: review fields and enum values.
- `20261001110100_service_request_review_boundary`: pending defaults, existing open-request index updates and legacy compatibility.

Previously unconfirmed relocations become pending employee review. Previously committed operational cancellations and confirmed relocations keep their existing authorization/operational commitments, with an explicit legacy note. Those notes do **not** claim that an employee reviewed historical customer-confirmed requests; absent employee reviewers remain null. No historical migration was edited and neither database was reset.

## Verification

Added `apps/api/test/service-request-review.e2e-spec.ts` with **20 PostgreSQL-backed scenarios** for both submissions, no preapproval side effects, funded refund estimates/reservations, approval/rejection, all employee review roles, customer/anonymous denial, legacy confirmation denial, scheduled versus completed outcomes, safe rejection details/private notes, conflicting and identical concurrent decisions, withdrawal, notification read behavior/counts, provider/retry/demo/override bypass prevention and concurrent rescheduling.

Added **6 frontend tests** in `request-review.test.tsx` for reason validation, separate private notes, approval wording, busy controls, and filtered queue links for all employee roles. Updated existing relocation service/customer UI and cancellation lifecycle regression expectations to the new review boundary, including asserting that the customer never calls `/confirm`.

Commands executed successfully:

```text
pnpm --filter @mero-telecom/api test
pnpm --filter @mero-telecom/web test
pnpm --filter @mero-telecom/api test:e2e:run -- --runTestsByPath test/service-request-review.e2e-spec.ts test/collections.e2e-spec.ts test/notifications.e2e-spec.ts
pnpm --filter @mero-telecom/api test:e2e:run -- --runTestsByPath test/service-request-review.e2e-spec.ts
pnpm --filter @mero-telecom/api test -- --runTestsByPath src/modules/relocations/relocations.service.spec.ts
pnpm --filter @mero-telecom/web test -- src/features/relocations/relocation-detail.test.tsx
pnpm typecheck
pnpm lint
pnpm --filter @mero-telecom/api exec prisma validate
pnpm --filter @mero-telecom/api exec prisma migrate status
pnpm --filter @mero-telecom/api exec prisma migrate deploy
git diff --check
```

Integration commands used the existing isolated PostgreSQL database on localhost:5433 and Redis on localhost:6380. Source schema/migration verification and development migration deployment used localhost:5432. Unit regression suites passed **526 backend tests** and **150 frontend tests**. The combined review/collection/notification run passed **39 tests** before the last added reschedule race; the final review-only run verifies all **20** review scenarios. Focused tests and type checks were repeated for the final reschedule/conflict-refresh changes. New integration fixture cleanup is scoped to this suite's own records.

## Previous behavior and remaining existing limitations

Corrected paths found during inspection:

1. Cancellation submission immediately set the subscription to `CANCELLATION_PENDING`, synchronized Stripe, reserved an approved cancellation refund and started immediate wholesale cancellation.
2. Relocation submission immediately changed the customer's primary/billing address and BILLING address record, and could populate the authoritative service-address pointer.
3. The customer frontend immediately called `/confirm` after creating a relocation; that customer-accessible endpoint started provisioning or scheduled operations.

Remaining existing limitations are documented rather than silently changing business logic:

- Wholesale providers are mock/demo integrations; test success does not verify live NBN/MNF disconnection or provisioning.
- After approval, the existing immediate Stripe cancellation still occurs before wholesale provider completion. A later wholesale failure can restore local service state while Stripe is already canceled; this provider/Stripe compensation issue predates the review change.
- Existing workflow notification enqueue failures are logged, with BullMQ retries once jobs are enqueued. There is no new request-specific durable notification outbox for a failure before enqueue. Pending queues remain driven by persisted request state.
- The legacy broad `app.e2e-spec.ts` setup clears shared test tables. Its cancellation scenario was updated for the new approval step, but that destructive broad suite and the reset-based `test:e2e` wrapper were not run. The isolated integration suites above were used instead.
- The cancellation form retains its existing immediate/end-of-period choices. No arbitrary-date cancellation policy or new refund approval hierarchy was invented.
