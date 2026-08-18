# API foundation

The API exposes versioned routes below `/api/v1`. Process liveness is available at:

```text
GET /api/v1/health
```

Dependency readiness is available at `GET /api/v1/health/ready` and reports PostgreSQL and Redis
independently. Production traffic should use readiness as its health gate.

Interactive OpenAPI documentation is available locally at `/api/docs`; its JSON document is
available at `/api/docs-json`.

All DTO validation uses a global NestJS validation pipe with whitelisting, rejection of unknown
properties, and type transformation. Errors use a consistent response structure and never expose
internal exception details.
