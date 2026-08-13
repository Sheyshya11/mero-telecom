# Authorization and ownership

Phase 5 establishes reusable backend authorization controls:

- `@Roles(...)` declares which authenticated roles may access a route; `RolesGuard` enforces it.
- `@CustomerOwnership(...)` marks the route parameter that identifies a customer. For a CUSTOMER
  user, `CustomerOwnershipGuard` verifies that the database customer record belongs to the
  authenticated user. ADMIN and STAFF users are allowed according to their operational duties.

The temporary `/api/v1/access-control` endpoints verify the authorization contract during the
foundation phase. They return only access confirmation and no customer data. Future business
controllers apply the same guards before querying or returning a customer resource.
