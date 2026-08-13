# Customer management API

All customer endpoints require a bearer access token.

| Endpoint                                  | Roles                        | Purpose                                                    |
| ----------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `POST /api/v1/customers`                  | ADMIN                        | Create a customer record.                                  |
| `GET /api/v1/customers`                   | ADMIN, STAFF                 | List/search customers using `page`, `limit`, and `search`. |
| `GET/PATCH /api/v1/customers/:customerId` | ADMIN, STAFF, owner CUSTOMER | Read/update a customer with server-side ownership checks.  |
| `GET/PATCH /api/v1/customers/me`          | CUSTOMER                     | Read/update the authenticated customer profile.            |

STAFF and CUSTOMER updates are deliberately limited to approved contact/address fields. Only an
ADMIN can change customer identity fields or account status.
