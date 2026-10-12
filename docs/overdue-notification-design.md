# Overdue notification escalation

The existing collection workflow, configurable 1/3/5/7-day defaults, notification severities, delivery queues, and payment/provider safeguards are preserved. This update changes communication and presentation within the existing services. The deadline correction is detailed in `overdue-collections.md`.

| Stage                  | Severity | Customer notification title                   | Presentation                                              |
| ---------------------- | -------- | --------------------------------------------- | --------------------------------------------------------- |
| First reminder         | WARNING  | Payment overdue                               | Polite amount-specific copy; mild warning                 |
| Second reminder        | WARNING  | Payment required — invoice still overdue      | Prompt payment request; stronger warning treatment        |
| Final warning          | CRITICAL | Final notice — service suspension approaching | Prominent FINAL NOTICE with exact suspension date         |
| Recovery final warning | CRITICAL | Final payment notice                          | Critical recovery copy and the one-time 48-hour deadline  |
| Successful suspension  | CRITICAL | Service suspended                             | Persistent critical treatment and Pay Outstanding Balance |

Email and in-app escalation copy share `overdueCommunication` in the existing overdue template. Reminder emails and the notification centre provide Pay Now and View Invoice actions using the authenticated invoice route. Suspension communications explain that payment begins restoration, rather than promising immediate restored service.

First and second reminders retain `PAYMENT_REMINDER` and distinguish themselves through `metadata.collectionStage`, titles, messages and presentation. Final warnings retain `FINAL_PAYMENT_WARNING`; successful suspensions retain `SERVICE_SUSPENDED`. The follow-up deadline correction adds nullable original/recovery deadlines and recovery acceptance timestamp through additive migrations; severity enums remain unchanged. Older reminders without stage metadata retain a generic reminder label.

The existing customer collection summary now exposes the highest recorded unpaid stage and links to its invoice. The dashboard uses that stage, rather than recreating collection timing in the browser. Its existing calculated suspension date respects saved policy, persisted original/recovery deadlines, previously announced final-warning dates and approved grace extensions. A refreshed summary replaces the displayed date after an extension. Payment/account reviews suppress the suspension date, and resolved balances hide the banner. Actual suspension and restoration processing retain their existing provider confirmation boundaries.

The bell and notification centre use existing warning/destructive design tokens, clear stage labels and stronger borders. The bell displays the complete critical message so the deadline remains visible. Earlier notifications remain in history with the details originally sent; new deadline extensions create their own customer communication. Reading or generating a later warning does not automatically remove earlier reminders.

Staff, Admin and Super Admin collection history shows human-readable first, urgent and final warning labels with notification-acceptance dates and the current scheduled suspension date. Approved grace extensions take precedence over an earlier displayed deadline. Existing role restrictions on manual reminders, grace extensions and policy editing are preserved. As before, notification acceptance means persisted in-app notification plus email queue acceptance; it does not prove SMTP delivery.

## Verification

- 547 API unit tests across 77 suites passed.
- 166 frontend tests across 38 files passed.
- 31 PostgreSQL integration tests across collection and notification suites passed.
- Workspace TypeScript checks, repository ESLint and whitespace checks passed.
- Actual rendered email templates were inspected in Playwright at desktop and 390px phone widths. The mobile final and recovery notices have no horizontal overflow; the recovery preview was checked at 390px with exact deadline time.

Regression coverage checks exact titles, subjects, amounts and deadline copy; increasing visual prominence; retained earlier reminders; highest unpaid stage selection across invoices; refreshed grace dates; payment before first/second/final warnings and suspension; unchanged manual-reminder timing; deduplication; and failed/pending suspension without a premature success notification.

Integration tests used only the local test PostgreSQL database on port 5433 and Redis on port 6380. Existing migrations were deployed into that isolated database without a reset. Provider fixtures use the existing mock provisioning adapter; no live Stripe payment or real internet-circuit operation was performed.

## Settled invoice notifications

The notification API checks linked invoices in one owner-scoped query per page. Payment notices for confirmed PAID or CANCELLED invoices include an `invoiceResolution` alongside their original content. This also corrects old notices, including notices linked by invoice number, payment ID or metadata invoice ID, without a backfill. Partial, processing and failed payments leave invoice notices actionable. Other invoices and unrelated workflows remain unchanged.

The bell and history display resolved notices neutrally, replace stale warning copy with the current invoice outcome, and offer View Invoice instead of Pay Now. History retains the original communication and sent time under Original notice; resolved items show the settlement time. The separate successful invoice notification stays green and links to the specific invoice. The open bell and history refresh every 30 seconds and on focus. Read/unread state remains independent of resolution, so the badge counts unread notifications, including unread resolved history. Invoice settlement never implies confirmed service restoration.
