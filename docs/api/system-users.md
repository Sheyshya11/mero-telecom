# System-user provisioning and super-administrator operations

PostgreSQL is the authoritative source for the explicit `SUPER_ADMIN`, `ADMIN`, `STAFF`, and
`CUSTOMER` roles. Authorization never compares enum order. A central role-to-permission map and a
target-based policy enforce the following boundaries:

- `SUPER_ADMIN` can manage staff and administrators. Managing another super administrator requires
  a password login no more than `ENHANCED_AUTH_MAX_AGE_SECONDS` ago (600 seconds by default).
- `ADMIN` can invite, suspend, reactivate, and deactivate staff. An administrator cannot assign a
  role or manage an administrator/super-administrator account.
- `STAFF` and `CUSTOMER` have no privileged account-management permission.
- Nobody can modify their own privileged role/status or remove the final active super administrator.

The JWT guard reloads the active user from PostgreSQL for every protected request. Role/status
changes revoke the target's refresh sessions. Access tokens are short-lived and become useless at
the next request because the database role is reloaded. Refreshing does not renew the signed
password-authentication timestamp.

## Additive migration runbook

Back up the database using the provider's normal snapshot process, then run:

```text
pnpm db:migrate
pnpm db:bootstrap-super-admin
```

The migration only adds `SUPER_ADMIN` to the existing PostgreSQL enum. It does not reset data,
delete users, change existing roles, or auto-promote an administrator. Validate after deployment:

1. Confirm the migration is listed by `prisma migrate status`.
2. Confirm all existing administrators remain `ADMIN`.
3. Configure the exact owner identity with `BOOTSTRAP_SUPER_ADMIN_EMAIL` and
   `BOOTSTRAP_SUPER_ADMIN_NAME`.
4. Run the explicit bootstrap command and inspect its `created`, `promoted`, `updated`, or
   `already-configured` result.
5. Accept a queued setup invitation if the command created a pending identity, then sign in and
   confirm `/admin/users` reports an active super administrator.

The command may promote only the exact matching existing `ADMIN`. It refuses staff/customer
identity conflicts, never searches for an arbitrary administrator, never creates a password, and
records `SUPER_ADMIN_BOOTSTRAPPED` transactionally. Once an active super administrator exists, a
different new bootstrap identity is refused. The legacy environment names `BOOTSTRAP_ADMIN_EMAIL`
and `BOOTSTRAP_ADMIN_NAME`, and `pnpm db:bootstrap-admin`, remain temporary compatibility aliases
and print deprecation warnings.

## Invitations and user management

The dashboard is `/admin/users`. Invitation links expire after `STAFF_INVITATION_TTL_HOURS`, store
only a token hash, are single-use, and bind acceptance to the pre-authorized email and role.

| Endpoint                                          | Access                                  |
| ------------------------------------------------- | --------------------------------------- |
| `POST /api/v1/admin/users/invitations`            | Admin: staff; super: staff/admin/super  |
| `GET /api/v1/admin/users/invitations`             | Admin and super admin                   |
| `POST /api/v1/admin/users/invitations/:id/resend` | Same target-role policy as creation     |
| `POST /api/v1/admin/users/invitations/:id/revoke` | Same target-role policy as creation     |
| `GET /api/v1/admin/users`                         | Admin and super admin, safe fields only |
| `PATCH /api/v1/admin/users/:id/role`              | Super admin, target policy enforced     |
| `PATCH /api/v1/admin/users/:id/status`            | Admin: staff; super: privileged users   |
| `GET /api/v1/admin/audit-logs`                    | Super admin only                        |
| `POST /api/v1/auth/staff-invitations/verify`      | Public and rate-limited                 |
| `POST /api/v1/auth/staff-invitations/accept`      | Public and rate-limited                 |

Final-super-admin checks run under a PostgreSQL transaction-scoped advisory lock with serializable
isolation, preventing concurrent demotions/deactivations from both succeeding. Deactivation is
reversible and preserves invoices, subscriptions, payments, invitations, and audit history. There
is no destructive privileged-user delete endpoint.

## Audit and recovery

Bootstrap, invitations, role transitions (`ADMIN_PROMOTED`, `ADMIN_DEMOTED`,
`USER_PROMOTED_TO_SUPER_ADMIN`, `SUPER_ADMIN_DEMOTED`), privileged status changes, recovery,
session revocation, and denied actions are audited. Sensitive audit metadata states whether recent
password verification was satisfied; tokens, passwords, hashes, cookies, and SMTP secrets are
never logged.

For break-glass recovery, temporarily set `RECOVERY_SUPER_ADMIN_EMAIL` to an exact existing super
administrator and run `pnpm db:recover-super-admin`. Remove it immediately afterward. The legacy
`RECOVERY_ADMIN_EMAIL` and `pnpm db:recover-admin` aliases are deprecated.

## Identity-provider limitation

Authentik and MFA are not integrated in this repository. Enhanced verification is therefore a
trusted backend check of the signed time of the most recent successful local password login, not
an MFA assertion. Before production claims MFA-grade assurance, configure Authentik/OIDC, link a
verified immutable subject to `User`, include an `auth_time` plus verified MFA/AMR claim, validate
issuer/audience/signature on the backend, and replace the local recency policy with that verified
claim. Keep PostgreSQL as the single application-role authority; do not independently authorize
from both IdP groups and `User.role`.
