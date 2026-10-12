# Overdue customer fixtures

Run from the repository root:

```sh
pnpm db:seed:overdue --dry-run
pnpm db:seed:overdue
# Also send the current alert to each customer:
pnpm db:seed:overdue --send-emails
```

The default batch creates two local demo customer accounts and uses the existing final-warning customer when their supplied email already exists. Each scenario has a $79 AUD simulated overdue invoice and an active service:

| Customer email              | Warning history                                                                  | Current collection state                             |
| --------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| subhamshrestha500@gmail.com | First and second reminders                                                       | SECOND_REMINDER                                      |
| heyebav950@copytosh.com     | First, second and final warning (third alert)                                    | SUSPENSION_SCHEDULED                                 |
| 5hvunoq2af@ooynib.com       | First and second reminders; ordinary final missed; recovery final warning issued | SUSPENSION_SCHEDULED with recoveryFinalWarningSentAt |

The default login password for newly created customers is `ChangeMe123!`. Set `OVERDUE_FIXTURE_PASSWORD` (12–128 characters) to choose another password for newly created accounts. The existing final-warning customer keeps their current password and account details. Login using one of the emails above to view the customer invoice and notifications, or search for these customers in the admin customer/subscription pages.

The script reads the persisted collection policy, falling back to the configured policy. Due dates and reminder timestamps are relative to the execution date, so they do not become obsolete as fixed calendar fixtures would. Ordinary final warnings retain the original policy suspension deadline; recovery fixtures have an expired original deadline, no ordinary final timestamp, and one new 48-hour recovery deadline. Both final scenarios remain active while suspension is scheduled. No provisioning request or successful payment is created.

Warning timestamps, collection audit history and in-app notifications are **simulated fixtures**, marked `simulated: true` and `emailSent: false`. By default, no SMTP email or queue job is created. `--send-emails` queues one real email for each scenario’s current alert through the existing encrypted email queue, after the seed transaction commits. Older simulated reminders are not emailed. The running API email worker rechecks balance, collection hold, stage and deadline before delivery, and records `EMAIL_DELIVERY_SENT` or `EMAIL_DELIVERY_FAILED`. Queue acceptance is recorded separately as `DEMO_OVERDUE_EMAIL_QUEUED`; it is not proof of SMTP delivery. The script makes no Stripe request, charge or actual service suspension. The historical fixture timestamps remain simulated; real delivery outcomes are recorded separately. A running API scheduler can subsequently advance the fixtures through the normal collection workflow as deadlines arrive.

The script requires `NODE_ENV=development` or `test`, a loopback PostgreSQL database URL, applied migrations, and the normal `OVERDUE_DEMO_DAY_MS=86400000` clock for both the API and script. It loads the existing repository and API `.env` files without overriding supplied environment variables. New accounts use a private manual-billing fixture plan. For the final-warning email, the explicitly authorized existing customer is reused: their email, password, recurring Stripe identifiers, current billing period and paid invoices/payments are preserved. The script adds a separate manual demo invoice and simulated warnings to their active subscription, updating only its collection timestamps and stage summary. It does not create a second subscription or modify their recurring payment setup. This reuse requires an active customer account with one active service, no other unpaid invoices, collection hold, grace extension or pending service operation; otherwise the batch is rejected. Public plans are unchanged. `--dry-run` reads policy and identities but performs no persistent writes and never queues emails, even when combined with `--send-emails`. Email sending requires configured SMTP, `EMAIL_FROM`, Redis and a running API worker. Normal `EMAIL_DELIVERY_MODE` routing applies: `direct` sends to the customer addresses above, while `redirect` sends to `EMAIL_DEV_RECIPIENT`. The script does not change global email settings.

Each invoice/event has a durable queue audit marker and deterministic queue job ID, so rerunning with `--send-emails` does not duplicate current-alert emails. Failed enqueue attempts leave no acceptance marker and can be retried by rerunning; SMTP retries belong to the email worker. Settled invoices, active collection holds, progressed warnings and expired deadlines are skipped.

Rerunning the same batch returns existing fixture records with their current state, without resetting debts, password/email changes, paid invoices, deadlines or notification history. Identity collisions report the occupied email and cause a rollback of the entire batch; existing customers and subscriptions are preserved. To create a fresh trio after existing fixtures have progressed:

```sh
pnpm db:seed:overdue --batch=demo2
```

The default `contacts` batch uses the three customer email addresses supplied by the user, in the scenario order above. The existing `demo` batch is preserved. Additional named batches use generated `.test` addresses to avoid reusing those identities. Batch names accept 1–12 lowercase letters, numbers or hyphens. Customer emails become `overdue-demo2-second@merotelecom.test`, `overdue-demo2-final@merotelecom.test`, and `overdue-demo2-recovery@merotelecom.test`.

## Verification

API type checking, targeted ESLint and Prettier checks passed. Seven isolated database integration checks passed in `test/overdue-fixtures.e2e-spec.ts`, covering target safeguards, read-only preview, complete fixture state/history, rerun preservation and whole-batch rollback on identity collisions, reuse of an existing customer while preserving credentials, recurring billing and paid history, and mocked email enqueue/retry/deduplication without sending test messages. Test fixture records are cleaned up afterward. The updated `contacts` batch preview checks the supplied email identities and shows the reused final-warning customer before creation. The development batch was then run with `--send-emails`: three current alerts were queued and all three worker jobs completed on their first attempt without being skipped. Three `EMAIL_DELIVERY_SENT` audits recorded SMTP provider message IDs. This confirms provider acceptance, not inbox placement. The 13 email queue regression checks also passed, including producer-only startup and worker suppression safeguards.
