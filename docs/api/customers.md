# Customer management API

All customer endpoints require a bearer access token.

| Endpoint                                               | Roles                        | Purpose                                                    |
| ------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------- |
| `POST /api/v1/customers`                               | ADMIN                        | Create a pending customer and send an activation link.     |
| `GET /api/v1/customers`                                | ADMIN, STAFF                 | List/search customers using `page`, `limit`, and `search`. |
| `GET/PATCH /api/v1/customers/:customerId`              | ADMIN, STAFF, owner CUSTOMER | Read/update a customer with server-side ownership checks.  |
| `GET/PATCH /api/v1/customers/me`                       | CUSTOMER                     | Read/update the authenticated customer profile.            |
| `POST /api/v1/customers/:customerId/invitation/resend` | ADMIN                        | Revoke old links and send a new activation link.           |

STAFF and CUSTOMER updates are deliberately limited to approved contact/address fields. Only an
ADMIN can change customer identity fields or account status.

Admin creation never accepts or generates a password. It creates a nullable-password `User` and
an `INVITATION_PENDING` customer, stores residential/service/billing addresses, and sends a
single-use activation URL. Only a SHA-256 hash of the random token is stored. Activation sets the
customer-chosen bcrypt password and changes both account records to `ACTIVE`. Suspended,
deactivated, or invitation-pending users cannot log in or refresh a session.

Public `POST /api/v1/auth/activation/verify`, `POST /api/v1/auth/activation`, and
`POST /api/v1/auth/activation/resend` support the activation UI. Resend returns a neutral response
to prevent email enumeration. Links expire after `ACCOUNT_INVITATION_TTL_HOURS` and each new link
revokes earlier pending links.
