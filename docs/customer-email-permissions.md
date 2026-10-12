# Customer email ownership

Existing customer email addresses are read-only in internal customer forms. Admin, Super Admin and Staff cannot change either the contact email or the linked login email through `PATCH /customers/:customerId`. Requests attempting a different email return 403; an unchanged legacy email value is accepted and ignored for compatibility. Other approved fields retain their existing permissions. Creating a new customer still accepts an initial email.

Customers change their own email from **My profile > Change email**. `PATCH /customers/me/email` accepts only `newEmail` and `currentPassword`; it selects the account from the authenticated session, never a supplied customer identifier. The customer role and password are checked again in the service. A shared per-user credential lock prevents using stale credentials alongside a concurrent password change.

The new address is normalized, validated and applied to the customer and login account in one transaction. Duplicate addresses roll back both records. The old address's verification timestamp is cleared rather than claiming the new address has been verified; the existing active account remains active. Other sessions and outstanding password-reset links are revoked; the current session is retained. A CUSTOMER_EMAIL_CHANGED audit records the owner and previous/new address without storing their password. The generic self-profile endpoint does not accept email changes.

No schema migration or live customer data changes are needed for this restriction. Tests use isolated local database fixtures.

## Verification

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- With test PostgreSQL on port 5433 and Redis on port 6380: `pnpm --filter @mero-telecom/api test:e2e:run --runTestsByPath test/customer-email.e2e-spec.ts`
- Prettier checks on changed source and this document; `git diff --check`.

Eight integration cases cover internal roles, owner-only updates, password checks, invalid input, duplicate addresses, old-session/reset revocation, login with the new address, and audit privacy. UI regressions cover read-only existing email, initial customer creation, omission from internal update payloads, and customer password-confirmed changes.
