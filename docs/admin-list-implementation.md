# Admin list implementation report

Implemented server-side pagination, search, domain filters and validated sorting for Customers, Subscriptions, Invoices, Refunds, Users and Audit Logs. Existing endpoints, authentication, ownership restrictions and role policies are retained.

## 1. Files created

- `apps/api/src/common/pagination.ts`
- `apps/api/src/common/pagination.spec.ts`
- `apps/api/src/common/admin-list-queries.spec.ts`
- `apps/api/src/modules/customers/customer-list.spec.ts`
- `apps/web/src/components/data-table.tsx`
- `apps/web/src/components/data-table.test.tsx`
- `apps/web/src/features/plans/use-plan-options.ts`
- `apps/api/prisma/migrations/20260905090000_admin_list_indexes/migration.sql`
- `docs/admin-list-implementation.md` (this report).

## 2. Files modified

- `apps/api/src/modules/customers/dto/pagination-query.dto.ts`
- `apps/api/src/modules/customers/customers.service.ts`
- `apps/api/src/modules/subscriptions/dto/subscription.dto.ts`
- `apps/api/src/modules/subscriptions/subscriptions.service.ts`
- `apps/api/src/modules/invoices/dto/invoice.dto.ts`
- `apps/api/src/modules/invoices/invoices.service.ts`
- `apps/api/src/modules/refunds/dto/refund.dto.ts`
- `apps/api/src/modules/refunds/refunds.service.ts`
- `apps/api/src/modules/system-users/dto/system-user.dto.ts`
- `apps/api/src/modules/system-users/system-users.service.ts`
- `apps/api/src/modules/system-users/system-users.types.ts`
- `apps/web/src/features/customers/customer.api.ts`
- `apps/web/src/features/customers/customer-management.tsx`
- `apps/web/src/app/admin/subscriptions/page.tsx`
- `apps/web/src/features/invoices/invoice-management.tsx`
- `apps/web/src/features/refunds/refund-management.tsx`
- `apps/web/src/features/system-users/system-user-management.tsx`
- `apps/web/src/features/system-users/system-users.api.ts`
- `apps/web/src/features/system-users/system-users.types.ts`
- `apps/api/prisma/schema.prisma`

## 3. API endpoints changed

All paths below use the existing `/api/v1` prefix. No duplicate admin customer endpoint was added.

| Endpoint | Change |
| --- | --- |
| GET /customers | Customer filters, whitelisted sorting, bounded pagination metadata |
| GET /subscriptions | Search, domain filters, sorting and pagination metadata |
| GET /invoices | Search, status/date/amount filters, sorting; customer ownership retained |
| GET /admin/refunds | Provider/customer/invoice search, date/amount filters, sorting, reduced list relationships |
| GET /admin/users | Created-date/active filters, sorting, accurate global active-super-admin count |
| GET /admin/audit-logs | Actor/resource/search/date filters and whitelisted sorting |

Existing invitation and plan-change endpoints are reused with actual page controls, so the UI no longer stops at the first 100 records. The invoice-generation subscription chooser now uses server-side active-status filtering, search and pagination.

## 4. Query parameters

Common: `page` (default 1), `limit` (default 20; 10/20/50/100 only), `search`, `sortBy` (default createdAt), `sortOrder` (asc/desc; default desc). Pages are integers bounded at 1,000,000; money filters are nonnegative integer cents. Invalid and unknown API parameters return validation errors.

| Module | Domain parameters | Allowed sort fields |
| --- | --- | --- |
| Customers | status, subscriptionStatus, planId, state, postcode, createdFrom, createdTo | createdAt, updatedAt, firstName, lastName, email, status |
| Subscriptions | customerId, status, planId, billingCycle, paymentStatus, activatedFrom, activatedTo, cancelled, pendingPlanChange | createdAt, startDate, currentPeriodEnd, status |
| Invoices | customerId, status, dateFrom, dateTo, minAmount, maxAmount | createdAt, issueDate, dueDate, totalCents |
| Refunds | status, type, reason, dateFrom, dateTo, minAmount, maxAmount | createdAt, requestedAt, refundAmountCents, status |
| Users | role, status, active, createdFrom, createdTo | createdAt, updatedAt, displayName, email, role, status |
| Audit logs | action, entityType, entityId, actorUserId, actorRole, dateFrom, dateTo | createdAt, action, entityType |

Every sort has an ID tie-breaker. Records and filtered counts use matching database conditions. Main list responses include data plus page, limit, total, totalPages, hasNextPage and hasPreviousPage. Empty results have totalPages=1; out-of-range bookmarks can return to the last available page.

## 5. Shared components/helpers

- Backend: ListQueryDto, buildPaginationMeta, dateRange, amountRange.
- Frontend: useTableQueryParams, DataTableControls, DataTablePagination, TableSkeleton, SortHeader, and usePlanOptions.
- Search waits 400ms. Search, filters, sorting and page-size changes reset page 1.
- URL state uses browser history; defaults/empty values are omitted. Secondary tables use independent query prefixes.
- TanStack Query keys include the complete API query; previous rows remain visible during transitions.
- Filters use existing styled native selects/inputs and a collapsible responsive panel; the project does not have a shadcn Select/Sheet component to reuse.
- Customer plan choices reuse the existing plan catalogue with a short cache lifetime.

## 6. Prisma schema/index changes

Migration `20260905090000_admin_list_indexes` adds seven indexes:
- (createdAt, id) for User, Customer, Subscription, Invoice, Refund and AuditLog.
- (state, postcode) for Customer.

These support default list ordering and location filtering. Existing email/customer-number unique indexes and relation/status indexes remain. No redundant email indexes or ineffective B-tree contains-search indexes were added. The migration was applied successfully to the local database.

## 7. Tests and verification

- Added 65 backend cases: default/custom pagination, allowed sizes, invalid values, actual validation-pipe behavior, combined/individual filters, sorting, date/amount ranges, ownership and policy checks.
- Added seven frontend cases: debounce, reset rules, URL restore, history events, chips, sorting, boundary buttons, search-focus retention and out-of-range recovery.
- API: 42 suites / 258 tests passed.
- Web: 10 files / 51 tests passed.
- Both TypeScript checks and production builds passed.
- Scoped ESLint passed; Prisma schema validation passed.
- Live API smoke checks passed for customer, subscription, invoice, refund and user lists. Ordinary admin access to audit logs correctly returned 403.
- Browser verified customer search, combined state filtering, empty results, Back/Forward, reload restoration and responsive filter layout at 390px.
- Browser verified subscription page-size change to 10 and navigation from 1–10 to 11–13 of 13 records; Next was disabled on the final page. The separate plan-change table retained its own pagination state.
- The Playwright CLI was unavailable because package downloads were blocked; browser verification used the built-in browser connection instead.

## 8. Assumptions

- Existing enum names are authoritative: customers use INVITATION_PENDING, invoices use CANCELLED, and successful refunds use SUCCEEDED.
- NO_SUBSCRIPTION means no subscription records, including historical ones. Plan/status customer filters match the same subscription record. Combining NO_SUBSCRIPTION with a plan returns no matches.
- Subscription activation-date filters use service startDate. currentPeriodEnd is exposed as the stored billing-period end; there is no activatedAt or nextBillingDate column.
- Subscription payment status means a matching payment on a linked invoice. Pending plan changes include PENDING, CHECKOUT_CREATED, PROCESSING and SCHEDULED. Cancellation means current status CANCELLED.
- Invoice UNPAID means ISSUED or OVERDUE. REFUNDED/PARTIALLY_REFUNDED filters use linked payment statuses. The schema has no Stripe invoice ID, so that search field was not invented.
- ID search uses full UUIDs where IDs are PostgreSQL UUID columns. Human customer numbers and provider IDs use case-insensitive contains search.
- Date-only end dates include the entire UTC day. Existing monthly-only billing cycles remain unchanged.

## 9. Remaining deployment/verification notes

- Apply the committed migration to other environments through the normal deployment process; only the local database was migrated here.
- A signed-in super-admin browser audit-log flow was not exercised; its service filtering and policy enforcement were tested, and ordinary-admin denial was checked live.
- No production-scale load benchmark was run. For much larger datasets, measure query plans before considering PostgreSQL trigram indexes for contains search or cursor pagination for very deep pages.
- Existing business mutations and Stripe workflows were not exercised against live accounts during list verification; their existing automated suites passed.
