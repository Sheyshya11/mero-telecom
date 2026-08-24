# Subscriptions API

Subscriptions explicitly link a customer to an internet plan and retain prior records as history.
New subscriptions are created as `ACTIVE` only by the verified paid plan-checkout webhook.

| Endpoint                                      | Access              | Purpose                                                       |
| --------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `GET /api/v1/subscriptions`                   | Admin, Staff        | Lists subscription history with pagination.                   |
| `GET /api/v1/subscriptions/:subscriptionId`   | Admin, Staff, owner | Retrieves one subscription; customers are ownership-filtered. |
| `GET /api/v1/subscriptions/me`                | Customer            | Lists the authenticated customer's subscriptions.             |
| `PATCH /api/v1/subscriptions/:subscriptionId` | Admin, Staff        | Performs an allowed operational status transition.            |

Allowed staff lifecycle transitions are `PENDING → CANCELLED` (legacy cleanup),
`ACTIVE → SUSPENDED/CANCELLED`, and `SUSPENDED → ACTIVE/CANCELLED`. Staff cannot create or approve
subscriptions. Only one active subscription is allowed for a customer.
