# Production deployment

The production target is a Vercel frontend and a Render backend in the Singapore region. The
Render Blueprint provisions the NestJS API, managed PostgreSQL, and managed Redis (Render Key
Value). A separate private S3-compatible bucket stores invoice documents.

## Development/production separation

The current Stripe Projects environment is named `development` and writes local configuration to
`.env`. It is intentionally limited to Stripe test-mode credentials, the Resend shared development
sender, localhost URLs, and development-only external resources. Do not deploy that generated file
or reuse its provider credentials for a public environment.

When production deployment is explicitly approved:

1. Keep `development` unchanged and create a separate Stripe Projects environment with
   `stripe projects env create production --output .env.production`.
2. Provision or attach a separate private production bucket and bucket-scoped credentials. Do not
   reuse the development invoice bucket or its access token.
3. Verify a domain owned by Mero Telecom in the production SMTP provider, create a separate API
   key, and replace the `onboarding@resend.dev` sender. The production environment must not set a
   development-recipient redirect.
4. Create separate Stripe credentials and a webhook endpoint for the deployed API URL. This
   prototype currently rejects live Stripe keys, so accepting real payments requires an explicit
   go-live code/configuration review before any `*_live_*` credential is introduced.
5. Put backend secrets only in Render's protected environment and expose only
   `NEXT_PUBLIC_API_URL` to Vercel. Run the production smoke test in this document before serving
   users.

## Topology

| Component         | Provider               | Production configuration                                       |
| ----------------- | ---------------------- | -------------------------------------------------------------- |
| Next.js frontend  | Vercel                 | Project root `apps/web`                                        |
| NestJS API        | Render web service     | Root `render.yaml`; health path `/api/v1/health/ready`         |
| PostgreSQL        | Render Postgres        | Private connection string injected into the API                |
| Redis cache       | Render Key Value       | Private connection string; `allkeys-lru`; persistence disabled |
| Invoice documents | S3-compatible provider | Private bucket; no anonymous read/list access                  |

Use sibling custom domains such as `app.example.com` and `api.example.com` when possible. This
keeps the refresh cookie same-site and avoids browser policies that can block third-party cookies
between `vercel.app` and `onrender.com` domains.

## Production prerequisites and approvals

The version-controlled Blueprint selects paid Render plans (`starter` web/key-value and
`basic-256mb` PostgreSQL). The project owner must approve provider billing before creating it.
Deployment also requires signed-in Vercel and Render accounts, an S3-compatible bucket, SMTP
credentials, Stripe test-mode credentials, and either final custom domains or accepted provider
domains. Never paste credentials into source, CI logs, screenshots, or pull-request text.

Provider deployment is complete only when all resources exist, environment validation succeeds,
migrations finish, GitHub checks are green, and the smoke tests below pass. A committed Blueprint
by itself is deployment preparation, not evidence of a live release.

## Before deployment

1. Push the repository to a Git provider and confirm the GitHub Actions `Verify` job passes.
2. Decide the final frontend origin and API URL. `FRONTEND_URL` is an origin such as
   `https://app.example.com`; `NEXT_PUBLIC_API_URL` includes the API prefix, such as
   `https://api.example.com/api/v1`.
3. Create a private S3-compatible bucket and access key limited to get/put operations for that
   bucket. Block public ACLs/policies and enable provider-side encryption and lifecycle controls.
4. Keep PostgreSQL, Redis, JWT, Stripe, SMTP, and S3 credentials out of Vercel. They belong only in
   the Render service environment.
5. Use Stripe sandbox credentials. This prototype intentionally rejects live Stripe secret keys.

## Deploy the API and managed services on Render

Create a new Blueprint in Render from the repository's root `render.yaml`. The Blueprint uses paid
starter services because Render's pre-deploy command is needed to run database migrations before a
new API release receives traffic. PostgreSQL and Redis block public network access and communicate
with the API over Render's private network.

Render prompts for every variable marked `sync: false`:

| Variable                | Required value                                                          |
| ----------------------- | ----------------------------------------------------------------------- |
| `FRONTEND_URL`          | Exact HTTPS frontend origin, with no path                               |
| `STRIPE_SECRET_KEY`     | Restricted or standard Stripe test key (`rk_test_...` or `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the production API's Stripe test webhook             |
| `EMAIL_FROM`            | Sender accepted by the SMTP provider                                    |
| `SMTP_HOST`             | SMTP provider hostname                                                  |
| `SMTP_PORT`             | Provider port, commonly `465` or `587`                                  |
| `SMTP_SECURE`           | `true` for implicit TLS (usually port 465), otherwise `false`           |
| `SMTP_USER`             | SMTP username, or an empty value if the provider does not require one   |
| `SMTP_PASS`             | SMTP password, or an empty value if the provider does not require one   |
| `S3_ENDPOINT`           | S3-compatible HTTPS endpoint; empty only for native AWS S3              |
| `S3_BUCKET`             | Private invoice-document bucket name                                    |
| `S3_ACCESS_KEY_ID`      | Bucket-scoped access-key ID                                             |
| `S3_SECRET_ACCESS_KEY`  | Bucket-scoped secret                                                    |

Set `S3_REGION` and `S3_FORCE_PATH_STYLE` in `render.yaml` to match the chosen provider before
provisioning. The Blueprint generates independent JWT secrets and injects managed datastore
connection strings. It runs the following release sequence automatically:

```text
install -> Prisma client generation -> API build -> prisma migrate deploy -> API start
```

Do not run the development seed against production. After the API deploys, create a Stripe test
webhook for `https://api.example.com/api/v1/payments/webhook`, subscribe to
`checkout.session.completed`, set its signing secret in Render, and redeploy.

After the first successful document download, verify that the object is private, its key begins
with `invoices/`, and an `InvoiceDocument` row exists. Do not enable a public bucket URL.

## Deploy the frontend on Vercel

Import the same Git repository as a Vercel project and configure:

- Root Directory: `apps/web`
- Framework Preset: Next.js
- Node.js Version: 22.x
- Environment variable `ENABLE_EXPERIMENTAL_COREPACK=1` for stable use of the root
  `packageManager` declaration
- Environment variable `NEXT_PUBLIC_API_URL=https://api.example.com/api/v1` for Production

The version-controlled `apps/web/vercel.json` supplies the frozen install and build commands.
Vercel builds fail if `NEXT_PUBLIC_API_URL` is missing or points at a non-HTTPS remote host.
`NEXT_PUBLIC_API_URL` is intentionally public; do not add `DATABASE_URL`, `REDIS_URL`, JWT secrets,
Stripe secrets, or SMTP credentials to Vercel. Environment changes apply only to new Vercel
deployments, so redeploy after editing the API URL.

Set the final Vercel origin as `FRONTEND_URL` in Render and redeploy the API if the origin differs
from the value entered during Blueprint creation. CORS and the trusted-origin guard accept that
single normalized origin and send credentialed responses.

For the initial two-provider bootstrap, use the intended Vercel production origin as
`FRONTEND_URL` when creating the Render Blueprint, then put the resulting Render API URL into
Vercel. If either provider assigns a different final URL, update both variables and redeploy both
services before testing authentication.

## Production smoke test

Run these checks against the deployed URLs:

1. Open the frontend and confirm the login page and static assets load over HTTPS.
2. Request `GET https://api.example.com/api/v1/health`; expect HTTP 200 and `status: "ok"`.
3. Request `GET https://api.example.com/api/v1/health/ready`; expect HTTP 200 with both `database`
   and `redis` set to `"ok"`.
4. Send a CORS preflight with `Origin: https://app.example.com`; expect that exact
   `Access-Control-Allow-Origin` value and `Access-Control-Allow-Credentials: true`. Repeat with an
   untrusted origin and confirm it is not allowed.
5. Sign in through the deployed frontend, refresh the browser, and open a protected dashboard.
   This verifies the API request path, database-backed authentication, access-token flow, secure
   refresh cookie, and CORS together.
6. Confirm the Vercel deployment contains only `NEXT_PUBLIC_API_URL` from the application's
   environment contract. Inspect the browser network panel and verify no secret value is returned.
7. Confirm the Render deploy log shows `prisma migrate deploy` completed before the new API version
   became healthy.
8. As an authorized admin and customer, download an invoice PDF. Confirm the response is a PDF,
   an unauthorized/other-customer request is rejected, and the backing object has no public URL.
9. Complete one Stripe test Checkout and verify that only the signed webhook changes the payment
   and invoice to succeeded/paid. Re-deliver the same event and confirm no duplicate payment is
   created.
10. Send one invoice email to a controlled test mailbox and confirm no customer or production
    recipient was used during the smoke test.

Render treats readiness responses outside the 2xx/3xx range as unhealthy, so a release with an
unreachable PostgreSQL or Redis instance will not receive traffic. The liveness endpoint remains a
process-only check for diagnostics.

## Rollback and rotation

Use the provider rollback controls to restore the last known-good application build. Never roll
back database migrations with destructive ad-hoc SQL; deploy a tested forward migration instead.
After any suspected disclosure, rotate the affected Render secret and Stripe webhook secret, then
redeploy. Rotating either JWT secret invalidates the corresponding issued tokens.
