# Invoice PDF delivery

`GET /api/v1/invoices/:invoiceId/pdf` returns a PDF generated from authoritative invoice,
customer, subscription, and line-item records. It is available to administrators, staff, and the
invoice's owning customer only.

The document includes the Mero Telecom name, invoice number, bill-to details, service line items, GST-inclusive totals, and due date. No browser-calculated values or client-supplied PDF content are used.

In production the first request renders the PDF, writes it to a private S3-compatible bucket, and
persists only its internal storage key, MIME type, and size in `InvoiceDocument`. Later requests
read the private object; if it is missing, the API re-renders and replaces it. The bucket must not
allow public access and object keys are never exposed as public URLs.

Outside production, leaving the S3 settings empty enables an intentional development fallback that
renders the document in memory for each request. All responses use `application/pdf`, attachment
disposition, and private/no-store caching. The Next.js same-origin proxy at
`/api/invoices/:invoiceId/pdf` forwards the caller's bearer token and streams the binary response;
it does not bypass API authorization.
