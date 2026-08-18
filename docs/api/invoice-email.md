# Invoice email delivery

`POST /api/v1/invoices/:invoiceId/send` sends an authoritative invoice PDF by email. The endpoint
is restricted to administrators and staff; customers cannot choose a recipient or provide email
content. Draft and cancelled invoices are rejected.

The backend obtains the authoritative private PDF, builds both plain-text and HTML email bodies,
and sends through the configured SMTP provider. In non-production environments every message is
redirected to `EMAIL_DEV_RECIPIENT`, regardless of the customer's address. Production uses the
customer email stored by the backend.

Successful deliveries create an `INVOICE_EMAIL_SENT` audit record containing the invoice, actor,
recipient, provider message ID, and timestamp. Repeating the request for the same invoice and
recipient returns `already_sent` without sending another message. Concurrent requests in one API
instance share the same in-flight delivery.

## Local acceptance test

Mailpit captures development mail locally without delivering it to the public internet:

1. Configure the `EMAIL_*` and `SMTP_*` values shown in `.env.example`.
2. Run `docker compose up -d mailpit`.
3. Start the API and authenticate as the seeded administrator or staff account.
4. Send an eligible invoice with `POST /api/v1/invoices/:invoiceId/send`.
5. Open `http://localhost:8025` and verify the configured development recipient, invoice summary,
   and PDF attachment.

SMTP usernames and passwords are optional for local Mailpit but should be injected as private
environment variables for hosted providers. They must never be committed or returned by the API.

## Resend development SMTP

Resend can exercise the hosted SMTP path before a custom domain exists. Keep `NODE_ENV=development`
so the backend redirects every invoice to `EMAIL_DEV_RECIPIENT`, then configure:

```text
EMAIL_FROM=Mero Telecom Billing <onboarding@resend.dev>
EMAIL_DEV_RECIPIENT=<the email address that owns the Resend account>
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=<development Resend API key>
```

The shared `resend.dev` sender can deliver only to the email address associated with the Resend
account. It is therefore suitable for local acceptance tests but not staging or production. Store
the API key through Stripe Projects project variables; do not hand-edit the CLI-managed `.env`.
