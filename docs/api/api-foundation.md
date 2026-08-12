# API foundation

The API exposes versioned routes below `/api/v1`. The initial health endpoint is:

```text
GET /api/v1/health
```

Interactive OpenAPI documentation is available locally at `/api/docs`; its JSON document is
available at `/api/docs-json`.

All DTO validation uses a global NestJS validation pipe with whitelisting, rejection of unknown
properties, and type transformation. Errors use a consistent response structure and never expose
internal exception details.
