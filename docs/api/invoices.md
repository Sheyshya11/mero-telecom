# Billing and invoices API

Invoice totals are calculated only on the backend from the assigned plan's integer-cent monthly price. Mero Telecom's prototype prices are GST-inclusive: GST is calculated as `total / 11`, rounded to the nearest cent, and `subtotal + GST = total`.

| Endpoint                                   | Access                 | Purpose                                                         |
| ------------------------------------------ | ---------------------- | --------------------------------------------------------------- |
| `GET /api/v1/invoices`                     | Admin, Staff, Customer | Lists invoices; customer results are ownership-filtered.        |
| `GET /api/v1/invoices/me`                  | Customer               | Lists the authenticated customer's invoices.                    |
| `GET /api/v1/invoices/:invoiceId`          | Admin, Staff, owner    | Retrieves one invoice with its line items.                      |
| `POST /api/v1/invoices/generate`           | Admin, Staff           | Generates an issued monthly invoice for an active subscription. |
| `POST /api/v1/invoices/:invoiceId/send`    | Admin, Staff           | Emails the authoritative PDF through the configured provider.   |
| `PATCH /api/v1/invoices/:invoiceId/status` | Admin                  | Performs an allowed invoice-status transition.                  |
| `GET /api/v1/invoices/:invoiceId/pdf`      | Admin, Staff, owner    | Downloads a generated invoice PDF.                              |

Generation accepts only `subscriptionId` and an optional `issueDate`; clients never supply money values or invoice numbers. A database uniqueness constraint prevents duplicate invoices for the same subscription and issue date. Generated invoices use fourteen-day payment terms and an `INV-YYYY-######` sequence.

## Stripe sandbox payments

| Endpoint                                 | Access   | Purpose                                                                  |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `POST /api/v1/payments/checkout-session` | Customer | Creates or resumes Checkout for an owned issued/overdue invoice.         |
| `POST /api/v1/payments/stripe/webhook`   | Stripe   | Verifies Stripe's raw-body signature and records trusted payment events. |

The checkout endpoint accepts only an `invoiceId`; the server retrieves the invoice's amount and
currency itself and sends the customer to Stripe-hosted Checkout. An invoice becomes `PAID` only
after a verified `checkout.session.completed` event reports `payment_status: paid`. Payment records
persist the Checkout Session and PaymentIntent identifiers, while provider event IDs make webhook
processing idempotent.

## Invoice email

Development messages are always redirected to the configured test recipient. Successful sends are
audited and idempotent for each invoice-recipient pair. See `docs/api/invoice-email.md` for provider
configuration and the local acceptance workflow.
