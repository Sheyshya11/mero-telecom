# Internet plans API

The plan catalogue uses integer cents for `monthlyCents` so monetary values remain exact.

| Endpoint                       | Access       | Purpose                                                      |
| ------------------------------ | ------------ | ------------------------------------------------------------ |
| `GET /api/v1/plans/public`     | Public       | Lists active plans only, ordered by price.                   |
| `GET /api/v1/plans`            | Admin, Staff | Lists all plans, including inactive ones.                    |
| `GET /api/v1/plans/:planId`    | Admin, Staff | Retrieves one plan.                                          |
| `POST /api/v1/plans`           | Admin        | Creates a plan.                                              |
| `PATCH /api/v1/plans/:planId`  | Admin        | Updates a plan or sets `isActive` to activate/deactivate it. |
| `DELETE /api/v1/plans/:planId` | Admin        | Deletes a plan with no subscription history.                 |

Plans are deactivated instead of deleted. This preserves a stable catalogue record for subscriptions and invoices introduced in later phases.
