# Authorization and ownership

Reusable backend authorization controls protect every business resource:

- `@Roles(...)` declares which authenticated roles may access a route; `RolesGuard` enforces it.
- `@CustomerOwnership(...)` marks the route parameter that identifies a customer. For a CUSTOMER
  user, `CustomerOwnershipGuard` verifies that the database customer record belongs to the
  authenticated user. ADMIN and STAFF users are allowed according to their operational duties.

The `/api/v1/access-control` endpoints remain as small authorization diagnostics, while customer,
subscription, invoice, payment, and dashboard controllers apply the same guards to real records.
Customer-facing queries also filter by the authenticated user's customer ID, so a guessed UUID
cannot cross the ownership boundary. DTO whitelisting rejects attempts to change protected fields
such as status, role, identifiers, or billing data through self-service routes.
