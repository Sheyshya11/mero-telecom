# Admin dashboard API

`GET /api/v1/dashboard/admin` is restricted to administrators. It returns backend-calculated operational information:

- customer count and active subscription count;
- monthly recurring revenue from active subscription plan prices;
- outstanding invoice value and overdue count;
- six monthly invoice-value buckets;
- subscription status counts; and
- five most recent invoices.

All money values are integer cents. Dashboard totals are derived from the database; browser code only formats values for display.

## Redis cache

The admin summary uses the versioned Redis key `mero-telecom:dashboard:admin:v1`. A cache miss
queries PostgreSQL and stores the complete JSON-safe response with the configured
`ADMIN_DASHBOARD_CACHE_TTL_SECONDS` expiry (60 seconds by default). A cache hit returns without
running the aggregation queries. Expiry bounds how long dashboard data can be stale.

Redis is an optimisation rather than a source of truth. If Redis is unavailable or contains
malformed cached JSON, the request falls back to PostgreSQL. The customer dashboard remains
uncached because Phase 15 intentionally starts with the broadly reused admin aggregation.

## Customer dashboard

`GET /api/v1/dashboard/customer` is restricted to customers. It resolves the customer record via
the authenticated user ID and only returns that customer's profile, current subscription and plan,
outstanding balance, latest invoice/payment status, and recent invoice history. It does not accept a
customer ID from the browser, preventing a customer from selecting another account's information.
