# Internet plans API

The plan catalogue uses integer cents for `monthlyCents` so monetary values remain exact.

| Endpoint                                 | Access       | Purpose                                             |
| ---------------------------------------- | ------------ | --------------------------------------------------- |
| `GET /api/v1/plans/public`               | Public       | Lists published plans by tier rank, price, then ID. |
| `GET /api/v1/plans`                      | Admin, Staff | Lists all plans, including inactive ones.           |
| `GET /api/v1/plans/:planId`              | Admin, Staff | Retrieves one plan.                                 |
| `POST /api/v1/plans`                     | Admin        | Creates a draft plan.                               |
| `PATCH /api/v1/plans/:planId`            | Admin        | Updates, publishes, pauses, or retires a plan.      |
| `PATCH /api/v1/plans/:planId/highlights` | Admin, Staff | Updates customer-facing highlights only.            |
| `DELETE /api/v1/plans/:planId`           | Admin        | Deletes an unused retired plan.                     |

New plans are drafts (`isPublic=false`, `isAvailable=false`). A plan can only be published when it
is active and has at least one active coverage rule. Retiring a plan also removes it from the public
catalogue and prevents new orders. Plans with coverage configuration, subscriptions, purchases, or
plan-change history cannot be deleted.

Every update and highlights request must include the plan's current ISO `updatedAt` value as
`expectedUpdatedAt`. A stale write returns `409 Conflict` instead of overwriting a newer change.
Deletion supplies the same value as the `expectedUpdatedAt` query parameter.

Plan mutations are recorded in the security audit log with the actor and before/after values.
Changing the catalogue price affects future subscriptions only; each subscription stores the
monthly price agreed when it was created.
