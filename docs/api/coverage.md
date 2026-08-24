# Public coverage lookup

`GET /api/v1/coverage?postcode=2000` returns the prototype service status for a four-digit
Australian postcode. Authentication is not required, and the endpoint is limited to 30 requests
per minute per client in addition to the global throttle.

The response contains:

- `postcode` — normalized input string.
- `status` — `AVAILABLE`, `PLANNED`, or `UNAVAILABLE`.
- `plans` — active plans ordered by monthly price when service is available; otherwise empty.
- `message` — user-facing status explanation.
- `qualificationRequired` — always reminds available customers that a final address qualification
  is still necessary.

This is a deterministic demonstration rule based on configured Sydney-area postcode ranges; it is
not an NBN service-qualification integration and must not be treated as a contractual availability
promise.
