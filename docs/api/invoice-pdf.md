# Invoice PDF delivery

`GET /api/v1/invoices/:invoiceId/pdf` returns a PDF generated in memory from authoritative invoice, customer, subscription, and line-item records. It is available to administrators, staff, and the invoice's owning customer only.

The document includes the Mero Telecom name, invoice number, bill-to details, service line items, GST-inclusive totals, and due date. No browser-calculated values or client-supplied PDF content are used.

PDFs are streamed to the caller and are not stored yet. Persistent document storage and invoice email delivery are later phases.
