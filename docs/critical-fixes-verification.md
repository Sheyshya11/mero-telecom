# Critical fixes verified — 12 October 2026

The three agreed critical issues have been fixed. The earlier audit report remains a historical record; this report documents the follow-up changes.

- **Upgrade invoice payment:** `PLAN_CHANGE` invoices now use the dedicated upgrade checkout and reconciliation flow before the new-subscription purchase guard. Regression tests cover ownership, missing requests, reuse, upgrade payment metadata and expired unsubmitted quotes. Existing paid-session reconciliation remains covered. Live Stripe payment submission was not performed.
- **PDF download:** both authenticated invoice proxies use binary transport without attachment headers. The existing client validates the PDF bytes and saves the PDF locally. A live customer-screen download of INV-2026-000002 succeeded: HTTP 200, 20,875 bytes, filename `INV-2026-000002.pdf`, no download failure. Evidence: `verified-invoice-after-fix.pdf`.
- **Current demo billing:** the local demo account now has an October 1–November 1 period; the dashboard shows November 1 as the upcoming date and $0 outstanding. The obsolete unsubmitted September upgrade quote is EXPIRED and its unpaid invoice is CANCELLED. Both paid invoices and their payment records matched the before/after checksum exactly. The old recurring setup was reconciled through the app while the period was still expired, preventing recurring activation. Automatic payments remain off. A new upgrade preview works in the UI without submitting payment.

Expired periods are no longer advertised as upcoming dashboard payments, and the automatic-payment setup button explains and blocks an expired manual period.

Validation: 79 backend suites / 623 tests, 40 frontend files / 206 tests; workspace typechecking and lint on changed source files passed. The repair safeguards were rerun after the final customer-facing message adjustment (12 tests passed).

For a later presentation date, preview the local fixture refresh with:

```powershell
pnpm --filter @mero-telecom/api db:repair-demo-billing
```

Apply a reviewed preview with `--apply`. The script requires development/test mode and a loopback PostgreSQL database, targets only `customer@merotelecom.test`, records an audit entry, refuses unresolved provider-backed or lifecycle activity, and is a no-op while the period is current. This is a demo fixture repair, not an automatic production billing-renewal job.

Lower-priority findings from the original audit were not changed. No real or test payment was submitted during this fix session.
