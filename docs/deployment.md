# Production deployment

Phase 18 targets a Vercel frontend and a Render backend in the Singapore region. The Render
Blueprint provisions the NestJS API, managed PostgreSQL, and managed Redis (Render Key Value).

## Topology

| Component        | Provider           | Production configuration                                       |
| ---------------- | ------------------ | -------------------------------------------------------------- |
| Next.js frontend | Vercel             | Project root `apps/web`                                        |
| NestJS API       | Render web service | Root `render.yaml`; health path `/api/v1/health/ready`         |
| PostgreSQL       | Render Postgres    | Private connection string injected into the API                |
| Redis cache      | Render Key Value   | Private connection string; `allkeys-lru`; persistence disabled |

Use sibling custom domains such as `app.example.com` and `api.example.com` when possible. This
keeps the refresh cookie same-site and avoids browser policies that can block third-party cookies
between `vercel.app` and `onrender.com` domains.

## Before deployment

1. Push the repository to a Git provider and confirm the GitHub Actions `Verify` job passes.
2. Decide the final frontend origin and API URL. `FRONTEND_URL` is an origin such as
   `https://app.example.com`; `NEXT_PUBLIC_API_URL` includes the API prefix, such as
   `https://api.example.com/api/v1`.
3. Keep PostgreSQL, Redis, JWT, Stripe, and SMTP credentials out of Vercel. They belong only in
   the Render service environment.
4. Use Stripe sandbox credentials. This prototype intentionally rejects live Stripe secret keys.

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

The Blueprint generates independent JWT secrets and injects managed datastore connection strings.
It runs the following release sequence automatically:

```text
install -> Prisma client generation -> API build -> prisma migrate deploy -> API start
```

Do not run the development seed against production. After the API deploys, create a Stripe test
webhook for `https://api.example.com/api/v1/payments/webhook`, subscribe to
`checkout.session.completed`, set its signing secret in Render, and redeploy.

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

Render treats readiness responses outside the 2xx/3xx range as unhealthy, so a release with an
unreachable PostgreSQL or Redis instance will not receive traffic. The liveness endpoint remains a
process-only check for diagnostics.

## Rollback and rotation

Use the provider rollback controls to restore the last known-good application build. Never roll
back database migrations with destructive ad-hoc SQL; deploy a tested forward migration instead.
After any suspected disclosure, rotate the affected Render secret and Stripe webhook secret, then
redeploy. Rotating either JWT secret invalidates the corresponding issued tokens.
