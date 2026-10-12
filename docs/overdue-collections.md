# Automated overdue collections: implementation report

Implemented by extending the existing invoice, subscription lifecycle, provisioning, audit, notification and BullMQ services. No parallel billing system or notification delivery infrastructure was introduced.

## Architecture and processing

`CollectionService` is registered inside the existing subscriptions module. The existing overdue lifecycle scheduler delegates invoice reconciliation, warning decisions and suspension requests to it, then reconciles existing provisioning requests and delivers durable notification intents. `CollectionPolicyService` provides the smallest persistent singleton policy; environment settings are the fallback until a Super Admin saves a policy.

Invoice overdue status, invoice collection stage and actual service status are separate. An overdue invoice leaves an active service available while warnings are sent. Existing legacy `PAST_DUE` services are accepted safely by the collection path. A remote Stripe subscription becoming `past_due` or `unpaid` no longer changes actual service state.

The processor scans eligible invoices in cursor-based batches rather than repeatedly selecting only the oldest page. Decisions use current invoice amounts, confirmed payments and subscription state. Payment and collection operations use serializable transactions; collection transactions retry serialization conflicts and acquire a subscription row lock. Provisioning rechecks eligibility under subscription/request locks immediately before applying the provider result.

## Stages and default timeline

Stages persisted on the existing Invoice model:

`NONE → FIRST_REMINDER → SECOND_REMINDER → FINAL_WARNING → SUSPENSION_SCHEDULED → SUSPENDED → RESOLVED`

| Elapsed time after due date | Default action                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Day 0                       | No automatic reminder or suspension                                                               |
| Day 1                       | First overdue reminder                                                                            |
| Day 3                       | Second reminder                                                                                   |
| Day 5                       | Final warning with suspension date                                                                |
| Day 7                       | Request suspension if all safety checks pass                                                      |
| Confirmed settlement        | Resolve invoice collection; restore eligible billing suspension once all required debt is cleared |

The original deadline is persisted once as `dueDate + suspensionDays × dayMilliseconds`. The shared `collection-deadline.ts` helper calculates the effective deadline as the latest of that original date, explicit administrative extension, persisted recovery date, and a legacy date actually announced by a final warning. Speculative first/second-reminder dates cannot postpone it. Reading or retrying never grants extra time. Final warning scheduling is `effectiveDeadline - (suspensionDays - finalWarningDays) × dayMilliseconds`; existing strictly ordered settings remain valid.

A normal run sends reminders on days 1/3/5 and suspends at day 7 after rechecking payment. Catch-up sends one highest currently due warning: a first run on day 4 sends the second reminder, then the final on day 5. Normal catch-up notices are at least one policy day apart. Earlier missed reminders are skipped rather than sent together; earlier reminder timestamps are not suspension prerequisites.

An unpaid eligible service past its effective grace deadline without an issued final warning enters recovery directly. The processor persists `recoverySuspensionDeadline = detectionTime + 48 actual hours` once, then issues the critical `RECOVERY_FINAL_WARNING` via the existing outbox. `recoveryFinalWarningSentAt` records acceptance separately from the normal final timestamp; the existing enum reaches `SUSPENSION_SCHEDULED` immediately on successful acceptance. No expired-date final warning is sent and no immediate suspension occurs. Repeated/concurrent runs and expired admin extensions cannot slide or recreate the recovery window. The default recovery window stays 48 hours even with an accelerated demo clock.

A recovery safety window covers the subscription across other unpaid invoices, including already queued suspension requests, because its notice promises continued service. Later authorized admin grace takes precedence. Extending an expired deadline starts from the current time; extending a future deadline adds calendar days to it. Extension notifications state the actual revised deadline, without repeating an already issued final warning. An unissued final warning moves relative to the extended deadline. If enqueueing recovery fails until its immutable deadline expires, suspension remains blocked and a deduplicated operational review is raised. A later explicit admin extension may permit retrying that same intent, without changing the original recovery date. Deduplicated customer notices refresh their deadline on retry.

Staff subscription headers, invoice cards and customer summaries use the same effective deadline. Recovery banners have distinct copy and recovery deadline times are shown in Adelaide time. Original expiry, missed warning, one-time extension, accepted recovery notice and scheduled suspension are auditable. Historical accepted notices remain in history; superseded outbox entries are explicitly marked skipped.

## Scheduler and configuration

The existing `mero-telecom-overdue-lifecycle` BullMQ queue runs on startup and repeats hourly by default, independently of customers opening the application. Jobs have three attempts and exponential backoff. Existing environment overrides remain effective.

| Setting                         | Default                 |
| ------------------------------- | ----------------------- |
| `OVERDUE_FIRST_REMINDER_DAYS`   | 1                       |
| `OVERDUE_SECOND_REMINDER_DAYS`  | 3                       |
| `OVERDUE_FINAL_WARNING_DAYS`    | 5                       |
| `OVERDUE_GRACE_PERIOD_DAYS`     | 7; suspension threshold |
| `OVERDUE_LIFECYCLE_INTERVAL_MS` | 3600000                 |
| `OVERDUE_LIFECYCLE_BATCH_SIZE`  | 50                      |
| `OVERDUE_DEMO_DAY_MS`           | 86400000                |

The saved singleton policy overrides the four environment timeline values. Both API validation and a database check enforce a positive, strictly increasing sequence. Policy values are whole days, at most 365.

For a development demo, use `OVERDUE_DEMO_DAY_MS=60000` and `OVERDUE_LIFECYCLE_INTERVAL_MS=30000` before starting the API to demonstrate the core 1/3/5/7 sequence in minutes. Production rejects an accelerated day and forces standard 24-hour elapsed days. The integration suite uses a controlled clock without changing production semantics. Administrative grace extensions retain their existing calendar-day calculation.

## Notifications and email

All messages use the existing centralized `NotificationService`, persisted in-app notifications, templates and encrypted BullMQ email queue.

| Trigger                                    | In-app event / severity                                                 | Email                                      |
| ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------ |
| First / second / manual reminder           | `PAYMENT_REMINDER`, WARNING                                             | Yes                                        |
| Final warning                              | `FINAL_PAYMENT_WARNING`, CRITICAL                                       | Yes                                        |
| Grace extension                            | `PAYMENT_GRACE_PERIOD_EXTENDED`, INFO                                   | Yes                                        |
| Successful suspension                      | `SERVICE_SUSPENDED`, CRITICAL                                           | Yes                                        |
| Successful restoration                     | `SERVICE_RESTORED`, SUCCESS                                             | Yes                                        |
| Restoration failed after payment           | Safe payment-received / restoration-processing message                  | Existing provisioning notification path    |
| Provider failure                           | `SERVICE_STATE_CHANGE_FAILED`, ACTION_REQUIRED to Admin and Super Admin | Existing operational notification behavior |
| Ambiguous processing, credits or workflows | Payment review required to Admin and Super Admin                        | Existing operational notification behavior |

Routine warning notifications are directed to the customer. They do not flood operational users. Messages contain the customer/invoice reference, outstanding amount, original due date, current status and suspension/grace date where appropriate, with authenticated invoice links. Date formatting uses Australia/Adelaide. No payment credentials are added to messages.

Collection AuditLog rows also form a durable notification outbox. Warning timestamps advance only after in-app persistence and email queue acceptance succeed. Queue outages retain the intent for retry. Email acceptance is not proof of SMTP delivery: the existing email worker owns delivery retries and final-failure reporting. It reloads the invoice and confirmed balance before sending a queued reminder, skips settled/superseded messages, suppresses expired final deadlines, and re-renders current deadline and balance even for legacy jobs. SMTP transport retains its existing at-least-once behavior.

## Suspension and restoration rules

Automatic suspension creates an existing `ServiceProvisioningRequest`; it does not preemptively change the subscription to suspended. Completion is required before writing `SUSPENDED`, `suspendedAt`, the existing `NON_PAYMENT` reason, invoice collection stage and success notification intent. Pending/failed provisioning leaves the actual automatic service state unchanged.

Suspension requires an accepted normal or recovery final warning issued before the effective deadline, an expired effective deadline, a positive current overdue balance, an active/legacy past-due service, no grace extension covering the action, no collection hold, no pending/processing payment on any unpaid invoice for the subscription, no future Stripe retry, and no blocking relocation/cancellation or unresolved recurring credit.

Restoration requires confirmed settlement and zero payable balance across **all issued/overdue invoices already due for the affected subscription**, not merely the invoice that triggered the webhook. Future invoices do not block restoration. Other subscriptions are managed independently. Restoration additionally requires the existing `SUSPENDED` status and `NON_PAYMENT` suspension reason, and provider completion. Manual administrative, fraud, compliance and other suspension reasons are not automatically restored.

A scheduler reconciliation repairs the payment-webhook-to-provisioning crash window. Active relocation/cancellation prevents automatic restoration and creates a durable operational review. A successful payment is never reported as failed merely because restoration failed or remains pending.

## Balances and edge cases

- **Partial payment:** payable balance is the invoice total minus confirmed successful payment amounts, clamped at zero. Pending amounts are never treated as cash. A partial payment cannot clear remaining required debt or restore service early. Existing customer Checkout still supports full invoice payments; this change does not introduce a partial-payment checkout or allocation subsystem.
- **Multiple invoices:** all due unpaid invoices on the subscription must be cleared for restoration. Any legitimate processing payment on an unpaid invoice blocks automatic suspension.
- **Credits:** invoice totals already include previously allocated credits. The existing ledger allocator applies additional eligible manual-billing credits to the remaining invoice balance, under its customer lock, without subtracting credits twice. A full credit stops collection. Recurring Stripe credits that are available/approved but not reconciled to a finalized invoice block suspension and require review instead of silently changing Stripe debt locally.
- **Refunds:** a refunded successful payment is not automatically converted back into new overdue debt. The existing credit/debit ledger remains authoritative for adjustment decisions.
- **Pending/direct debit:** pending and processing payments, including remote next-payment-attempt dates, prevent suspension. Long-running pending payments generate a deduplicated review. An explicit failed recurring intent reconciles the invoice placeholder payment; an unrelated processing payment is not cleared by an invoice-level failure without a matching intent.
- **Cancellation:** cancelled/terminated services are never suspended/restored by the collection path. Pending cancellation/disconnection and open cancellation requests are protected. Debt reminders can continue for a valid outstanding invoice; collection does not delete billing history or change cancellation state.
- **Relocation:** any relocation not completed, cancelled or force-closed is conservatively protected, including a failed relocation requiring intervention. Collection records a review and leaves relocation records untouched.
- **Manual suspension:** existing RBAC and manual suspension endpoints remain. Their reasons are preserved and checked before automatic restoration.
- **Duplicate invoices:** the existing unique subscription/billing-period constraint and Stripe invoice identity remain authoritative. No duplicate invoice generator was added.

## Administrative and customer interfaces

Existing Admin subscriptions management now shows outstanding invoice balances, due dates/days overdue, collection stage, scheduled date and durable collection history.

| Action                                        | Authorized roles                         |
| --------------------------------------------- | ---------------------------------------- |
| View collection history and policy            | Staff, Admin, Super Admin                |
| Additional manual reminder                    | Staff, Admin, Super Admin                |
| Extend grace with reason and actor/time audit | Admin, Super Admin                       |
| Set/release collection hold with reason       | Admin, Super Admin                       |
| Existing manual suspend/reactivate            | Existing Admin/Super Admin authorization |
| Save collection policy                        | Super Admin only                         |

The policy form is integrated into existing subscriptions management. Manual reminders have request keys and do not advance automated warning stages. Grace extension stores the extended deadline, reason, actor and time, and previews the new date. Super Admin inherits existing Admin permissions. Endpoint guards and DTO validation enforce permissions independently of button visibility.

Customer dashboard and subscription pages show overdue, approaching-suspension, suspended and restoration-processing banners. They show actual overdue amounts and suppress suspension dates while payment/account review blocks automation. Invoice deep links load the owned invoice even when it is outside the current history page. Manual invoices reuse existing Checkout; recurring invoices use a trusted Stripe hosted invoice link or the existing payment-method management path.

## History, idempotency and races

The existing AuditLog now has an optional unique deduplication key and notification delivery fields. It records overdue detection, warnings, scheduling, policy updates, manual reminders, grace extensions, hold changes, resolution, suspension/restoration completion and operational failures. Actor IDs are stored for administrative actions; system actions use a null actor. History survives notification reads/deletion.

Automatic warning keys are invoice plus event. Provisioning requests use stable suspension/restore keys; restoration keys identify the suspension cycle. In-app uniqueness, persistent outbox records and retained collection email job IDs prevent repeated scheduler/webhook execution from enqueueing duplicate normal actions. Completed and failed collection email jobs are retained for deduplication; production operations should account for that Redis retention.

Collection decisions are reloaded inside serializable transactions, and queued provisioning is validated again immediately before applying the result. A payment that settles between suspension intent and provisioning cancels the stale operation. Provider completion writes actual state and the success outbox together. Stale success notifications are suppressed if the service has since changed state. Integration tests exercise concurrent warning runs and the queued-suspension/payment race.

## Stripe integration

Existing signed-webhook verification, event deduplication, Checkout settlement and recurring `invoice.paid` handlers remain in use. They call the existing subscription lifecycle hook, which now checks collection balances and queues eligible restoration. Payment failures notify the customer; only an invoice whose due date has passed is marked overdue. A failed automatic attempt or remote `past_due` status does not bypass warning/grace rules.

No Stripe API version upgrade, new Stripe account or live financial operation was performed. Integration tests use local payment fixtures/provider mocks rather than live Stripe charges.

## Migration and verification

Added `20261001090000_overdue_collection_policy`: one policy table, one collection enum, additive invoice/subscription/provisioning/audit fields and indexes. Historical migrations were untouched. Migration status and datasource/model diff were inspected before deployment. The migration was applied to local development and test databases through `migrate deploy`, with no reset or manual database patch. Final status: 42 migrations applied; datasource/model diff empty.

Prisma validation passed. Client generation initially encountered the Windows query-engine DLL locked by the running API. Generation succeeded into an alternate temporary output; generated schema/client files were refreshed while preserving the locked compatible engine. Temporary generation artifacts were then removed. A fresh checkout should use normal Prisma generation with the API stopped if Windows locks the DLL.

Verification commands used the installed package binaries:

```powershell
node apps/api/node_modules/prisma/build/index.js validate --schema apps/api/prisma/schema.prisma
node apps/api/node_modules/prisma/build/index.js migrate status --schema apps/api/prisma/schema.prisma
node apps/api/node_modules/prisma/build/index.js migrate diff --from-schema-datasource apps/api/prisma/schema.prisma --to-schema-datamodel apps/api/prisma/schema.prisma --script
node apps/api/node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node node_modules/eslint/bin/eslint.js .
```

Backend unit tests ran from `apps/api` with `node node_modules/jest/bin/jest.js --runInBand`. Frontend tests ran from `apps/web` with `node node_modules/vitest/vitest.mjs run`. Collection and existing notification integration tests ran from `apps/api` against localhost test PostgreSQL/Redis:

```powershell
$env:DATABASE_URL='postgresql://mero_telecom:mero_telecom_test_password@localhost:5433/mero_telecom_test'
$env:REDIS_URL='redis://localhost:6380'
node node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand --runTestsByPath test/collections.e2e-spec.ts test/notifications.e2e-spec.ts
```

The repository's reset-based e2e wrapper was deliberately not used. The unrelated broad application e2e suite, which globally deletes fixtures, was not run.

Final results: **526 backend unit tests across 76 suites, 144 frontend tests across 37 files, and 20 PostgreSQL integration tests across two suites passed**. The affected frontend checks were repeated after the final banner change (21 tests across four files). Both TypeScript checks, repository ESLint, Prisma validation and `git diff --check` passed.

Added coverage includes the full day 0–7 timeline and duplicates; payment before/after suspension; complete balance across invoices; grace extension; partial and pending payments; real ledger credit allocation; non-billing suspensions; missed warnings; concurrent runs; stale provisioning; manual reminder idempotency; suspension/restoration failures with truthful customer and operational notifications; RBAC; collection holds; cancellation/relocation; canonical invoice uniqueness; queue outages; policy validation; customer banners; and administrative controls.

## Existing issues and practical limits

1. **Provisioning is MOCK-only in this repository.** The automatic workflow correctly uses the existing service-management request/retry/completion mechanism, but it cannot disconnect or reconnect a real internet circuit until that mechanism has a real provider adapter. A future adapter must preserve provider idempotency and confirmation, rather than treating request acceptance as completion.
2. **Legacy manual service actions update local state before provider completion.** Those unrelated manual workflows were preserved. The new automatic collection path waits for provider success and checks suspension reasons before restoring.
3. **Finalized recurring Stripe credit reconciliation needs review.** Automation protects such accounts rather than inventing a new credit-note or Stripe invoice editing system. Existing manual full-invoice Checkout also has no general partial-payment settlement UI; imported/manual partial payments require reconciliation before using that full-invoice payment path.
4. **Email queue acceptance and external delivery are distinct.** Warning history means accepted in-app plus email queue delivery intent. Real SMTP/Stripe/network-provider execution and browser visual QA were not exercised by the local automated checks.

## Deadline correction verification (7 October 2026)

Passed: 547 API unit tests (77 suites), 166 frontend tests (38 files), and 31 isolated PostgreSQL collection/notification integration tests. Additional regression coverage includes day-4 catch-up, direct post-expiry recovery, immutable 48-hour deadlines, payment during recovery, later explicit grace, pre-final grace, recovery queue outage/manual review, concurrent scheduler execution, pending direct debit versus failed payment, multiple invoices and stale provisioning, and refreshing deduplicated notices without altering read state/history. Desktop/mobile recovery email previews use the actual rendered template; mobile has no horizontal overflow at 390px.

Commands run:

```powershell
pnpm --filter @mero-telecom/api exec prisma format
pnpm --filter @mero-telecom/api exec prisma validate
pnpm --filter @mero-telecom/api exec prisma generate
pnpm --filter @mero-telecom/api exec prisma migrate deploy
pnpm --filter @mero-telecom/api exec prisma migrate status
pnpm --filter @mero-telecom/api exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
pnpm --filter @mero-telecom/api test
pnpm --filter @mero-telecom/web test
pnpm typecheck
pnpm lint
git diff --check
```

Integration run used explicit isolated test connections, without the reset wrapper:

```powershell
$env:DATABASE_URL='postgresql://mero_telecom:mero_telecom_test_password@localhost:5433/mero_telecom_test'
$env:REDIS_URL='redis://localhost:6380'
pnpm --filter @mero-telecom/api test:e2e:run --runTestsByPath test/collections.e2e-spec.ts test/notifications.e2e-spec.ts
```

The two additive migrations preserve existing records: the first adds original/recovery state and the second makes the timestamp check respect a later authorized effective deadline. Client generation succeeded; development and test migrations are applied with no schema diff. The local API was restarted and health checked. Its startup reconciliation recovered the previously shown `INV-2026-000003`: the warning was accepted at `2026-10-07T11:25:50.532Z`, the immutable recovery deadline is `2026-10-09T11:25:50.532Z`, and subscription grace plus invoice schedule agree (9 October, 9:55 pm Adelaide). The service remains `PAST_DUE`, with no premature suspension. Screenshots are rendered fixture previews, rather than evidence of live email delivery.

Provisioning retains the existing mock adapter: passing tests and local state are not confirmation of a real circuit disconnect. Notification acceptance remains in-app persistence plus queue acceptance; the existing email worker separately records SMTP delivery/failure.

Changed source and documentation files pass Prettier and `git diff --check`. Repository-wide `pnpm format:check` also ran and reports existing formatting issues in unrelated web screens, lockfile and older generated evidence artifacts; those files were preserved.
