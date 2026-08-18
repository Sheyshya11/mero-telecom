# Limitations and future improvements

## Current limitations

- Coverage is a deterministic postcode demonstration, not an NBN address qualification or service
  ordering integration.
- Stripe is test mode only. There are no live payments, refunds UI, disputes, failed-payment retry
  automation, or accounting reconciliation.
- Invoice email is manual. There is no scheduled billing job, recurring invoice run, reminder
  sequence, bounce processing, or customer communication preference centre.
- The prototype does not provision routers, RADIUS/AAA access, network inventory, usage metering,
  outages, support tickets, or technician work orders.
- Staff capability is intentionally narrow and there is no UI for provisioning users, resetting
  passwords, multi-factor authentication, or fine-grained custom roles.
- Audit records are database-backed but there is no audit-search UI, append-only external archive,
  SIEM export, tracing backend, or alerting integration.
- Admin dashboard caching is single-key and short-lived; it does not provide analytics history or
  a data warehouse.
- Currency, tax treatment, billing cadence, and address validation are tailored to the Australian
  monthly prototype.
- Production deployment depends on project-owner Vercel/Render access, paid-plan approval, DNS,
  SMTP, private S3-compatible storage, and Stripe test webhook configuration.

## Recommended improvements

1. Add provider-backed address qualification and keep the result timestamp/evidence with an order.
2. Add MFA, password-reset/email verification, admin user provisioning, and optional external IdP
   support before handling real customer data.
3. Move scheduled billing and email reminders to an idempotent background job queue with retry and
   dead-letter handling.
4. Add object retention/deletion policies, storage encryption controls, and periodic private-document
   integrity checks.
5. Add live-mode readiness controls only after compliance, refund/dispute, reconciliation, webhook
   monitoring, and incident procedures are approved.
6. Export logs, metrics, traces, and security/audit events to managed observability systems with
   actionable alerts and retention policies.
7. Add broader browser automation, accessibility scans, load/rate-limit tests, backup restoration
   drills, and migration rollback rehearsals.
8. Add support, network provisioning, inventory, usage, and outage modules as separate bounded
   contexts only when business requirements are defined.

These are explicit post-MVP items; none should weaken the current rule that the API and database
remain authoritative for identity, money, ownership, and state transitions.
