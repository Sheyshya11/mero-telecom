# Address lookup and coverage qualification

Coverage has two deliberately separate responsibilities:

1. Geoapify identifies and normalizes Australian addresses.
2. Mero Telecom's PostgreSQL records decide preliminary serviceability and compatible plans.

Geoapify is not an internet-availability, nbn Site Qualification, or ordering authority. Every
public result says it is a Mero Telecom database estimate and may require final confirmation.

## Provider and trust boundary

The API implements `AddressLookupProvider` and `CoverageQualificationProvider` abstractions. The
configured implementations are `GeoapifyAddressProvider` and
`DatabaseCoverageQualificationProvider`. Controllers, Redis selection handling, and the frontend
depend on the provider-independent contracts.

The browser calls only Mero Telecom's API. The API calls Geoapify's Address Autocomplete endpoint
with `filter=countrycode:au`, `format=json`, and `limit=5`; the API key never enters a browser
bundle or JSON response. Provider responses are normalized and malformed, non-Australian,
coordinate-free, or location-incomplete results are discarded.

Each displayed suggestion receives a cryptographically random token. Redis stores the normalized
address behind a hash of that token for a short TTL. `POST /coverage/check` atomically consumes the
token, so arbitrary browser-supplied state, postcode, or coordinates cannot be qualified and a
token cannot be replayed. Redis failure returns `503` rather than falling back to untrusted input.

## Environment

```text
ADDRESS_LOOKUP_PROVIDER=geoapify
GEOAPIFY_API_KEY=replace-with-a-development-key
COVERAGE_QUALIFICATION_PROVIDER=database
ADDRESS_LOOKUP_MIN_CHARACTERS=3
ADDRESS_LOOKUP_CACHE_TTL_SECONDS=600
ADDRESS_SELECTION_TTL_SECONDS=900
PUBLIC_CHECKOUT_CONTEXT_TTL_SECONDS=1800
```

Create a Geoapify account, create a project, and copy a project API key from its API Keys section.
Geoapify's current official setup and endpoint instructions are in the
[Address Autocomplete API documentation](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/).
Put the key in the untracked root `.env` for local development, never `.env.example`, frontend
variables, source, screenshots, or logs.

Free-tier requests are conserved in three layers: the UI waits for three characters and debounces
for 400 ms, React Query cancels stale requests, and the API caches normalized repeated-query
results for 10 minutes by default. Public endpoints also have an endpoint-specific IP throttle.

## Public routes

### `GET /api/v1/coverage/address-suggestions?query=<text>`

- Public; maximum 20 requests per minute per client.
- Trims a 3–150 character query.
- Returns at most five display-safe suggestions.
- Does not return coordinates, provider address IDs, cache keys, raw payloads, or API keys.

```json
{
  "suggestions": [
    {
      "selectionToken": "short-lived-single-use-token",
      "formattedAddress": "1 North Terrace, Adelaide SA 5000, Australia",
      "suburb": "Adelaide",
      "state": "South Australia",
      "stateCode": "SA",
      "postcode": "5000"
    }
  ]
}
```

Provider timeouts or errors return a safe `503`. No matching address is a successful response with
an empty `suggestions` array.

### `POST /api/v1/coverage/check`

```json
{ "selectionToken": "short-lived-single-use-token" }
```

The response status is one of `AVAILABLE`, `COMING_SOON`, `NOT_AVAILABLE`,
`OUTSIDE_OPERATING_REGION`, or `MANUAL_REVIEW`. It includes the selected display address,
estimated technology and maximum speed, check time, and compatible public plans. It never includes
admin notes, override reasons, provider payloads, or internal region identifiers. An expired or
already-consumed token returns `410`; unavailable trusted-selection storage returns `503`.

An `AVAILABLE` response also contains a one-use `qualificationToken`. The landing-page plan action
posts that token and the chosen compatible plan to the Payments module. The token is never placed
in a URL and does not contain address data; Redis remains authoritative.

```json
{
  "status": "AVAILABLE",
  "qualificationToken": "short-lived-single-use-token",
  "plans": [{ "id": "compatible-plan-id" }]
}
```

## Database decision order

1. Require Australia and normalize Australian state codes/full names case-insensitively.
2. Find the configured state. `COMING_SOON` returns that result; missing/disabled returns
   `OUTSIDE_OPERATING_REGION`.
3. Apply an active exact-address override matching provider and provider address ID.
4. Otherwise load one active record for the exact region and four-digit postcode. Numerical
   postcode ranges are never inferred.
5. Map `PARTIAL` to `MANUAL_REVIEW`, unless a definitive exact-address override already won.
6. For available technology/speed, return only existing active, public, orderable plans with an
   active compatible rule for that technology and optional state/postcode/speed scope.
7. Return `MANUAL_REVIEW` when the location appears serviceable but no compatible plan exists.

## South Australia demonstration configuration

The repeatable development seed creates only one active operating region: `AU / SA / South
Australia`. It adds clearly fictional demonstration records for:

- `5000` — `AVAILABLE`, FTTP, 1000 Mbps maximum;
- `5001` — `PARTIAL`, FTTC, 100 Mbps maximum;
- `5114` — `COMING_SOON`;
- one deterministic fixture provider address in `5000` — exact `UNAVAILABLE` override.

These records demonstrate application behavior; they do not claim actual nbn availability.

## Admin and staff operations

The UI is at `/admin/coverage` and `/staff/coverage`. Protected routes use
`/api/v1/coverage-management`.

Admins can:

- create/edit/activate/disable operating regions;
- create/edit/disable exact postcode records with status, technology, speed, date, and notes;
- create exact-address overrides from a trusted autocomplete selection, then edit/disable them;
- create/edit/disable plan compatibility rules with technology, speed, region, and postcode scope;
- search/filter records and view 30-day privacy-safe search analytics.

Staff can view regions and postcode records and run the same trusted address qualification, but
the API returns `403` for configuration mutation and analytics routes. Customers and anonymous
visitors cannot access management routes. Admin mutations create specific audit events in
addition to the existing safe administrative request audit.

To activate another state without code changes:

1. Create the `AU` operating region as `COMING_SOON` while records are prepared.
2. Add exact postcode coverage and any exact-address exceptions.
3. Add compatibility rules for the existing plans and technologies.
4. Test supported, unsupported, partial, and override addresses.
5. Change the region to `ACTIVE` only after review. Disable it to stop all new positive results
   without deleting historical configuration.

## Replacing providers later

For another address vendor, implement `AddressLookupProvider`, normalize into
`NormalizedAddressSuggestion`, register it for `ADDRESS_LOOKUP_PROVIDER`, extend configuration
validation, and add adapter tests. Public routes and database decisions do not change.

For an authorized nbn wholesale integration, implement `CoverageQualificationProvider` and
register it for `COVERAGE_QUALIFICATION_PROVIDER`. Keep the public response contract, safe errors,
audits, plan filtering, and server-trusted selected-address boundary. Do not scrape public retailer
sites or call unofficial nbn endpoints.

## Local verification

Start PostgreSQL/Redis, migrate and seed, place a development Geoapify key in `.env`, then run the
apps. Automated tests never make a live Geoapify call: unit tests use normalized fixtures and the
end-to-end suite injects a deterministic fake provider while exercising real Redis selection
tokens and PostgreSQL decisions.

```text
pnpm services:up
pnpm --filter @mero-telecom/api exec prisma migrate deploy
pnpm --filter @mero-telecom/api prisma:seed
pnpm dev
```

Use `/coverage` for public testing, `/admin/coverage` for configuration, and `/api/docs` for the
Swagger contract.
