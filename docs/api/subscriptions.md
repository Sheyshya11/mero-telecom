# Subscriptions API

Subscriptions explicitly link a customer to an internet plan and retain prior records as history.

| Endpoint                                      | Access              | Purpose                                                          |
| --------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| `GET /api/v1/subscriptions`                   | Admin, Staff        | Lists subscription history with pagination.                      |
| `GET /api/v1/subscriptions/:subscriptionId`   | Admin, Staff, owner | Retrieves one subscription; customers are ownership-filtered.    |
| `GET /api/v1/subscriptions/me`                | Customer            | Lists the authenticated customer's subscriptions.                |
| `POST /api/v1/subscriptions`                  | Admin, Staff        | Assigns an active plan as a pending subscription.                |
| `PATCH /api/v1/subscriptions/:subscriptionId` | Admin, Staff        | Changes a pending plan or performs an allowed status transition. |

Allowed lifecycle transitions are `PENDING → ACTIVE/CANCELLED`, `ACTIVE → SUSPENDED/CANCELLED`, and `SUSPENDED → ACTIVE/CANCELLED`. Only one active subscription is allowed for a customer.
