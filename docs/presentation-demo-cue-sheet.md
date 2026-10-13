# Mero Telecom demo cue sheet

Target: 8 minutes, excluding questions.

**Story:** customer checks coverage, signs up, manages billing and asks for help. Employees handle the request with permissions and review.

| Time | Show | Say / prove |
| --- | --- | --- |
| 0:00–0:45 | Title, `/website` | Academic ISP management prototype. Connect customer needs to employee work. |
| 0:45–1:45 | Address checker | Select recognised address, show compatible plans. Geoapify lookup; database-estimated coverage. |
| 1:45–2:35 | Checkout + saved TC03 screenshots | Previously recorded Stripe test checkout. Signed payment evidence activates records. Continue with prepared account. |
| 2:35–3:45 | Customer Overview, My Internet, Invoices, PDF | Subscription and billing connected. Money in cents. Customer ownership protects invoices. |
| 3:45–5:05 | Customer Support; Staff Support/Internal Requests | Submit test billing question. Match its reference in employee view. Show prepared linked escalation checkpoint if needed. |
| 5:05–6:05 | Admin Cancellations or Relocations | Submission leaves service unchanged. Review, scheduling and completion are distinct. Provider is simulated. |
| 6:05–7:00 | Admin Billing + architecture slide | Billed amounts differ from cash and outstanding debt. Next.js, NestJS, PostgreSQL, Redis. Backend is authoritative. |
| 7:00–8:00 | Recorded evidence + closing | 30 passing API/database assertions in recorded run. Seven cases passed within scope; relocation partial. Test payments, estimated coverage, simulated network provider. |

## Prepared support request

Category: Billing

Subject: Demo: explanation of monthly invoice

Message: This is an academic demonstration using test data. Please explain the billing period shown on my latest invoice.

## Prepare

Separate browser profiles: public, Customer, Staff, Admin. Same-profile tabs share authentication.

Have an active account, paid invoice, existing linked internal request and service-review checkpoint ready. Verify the coverage address against the current database. Do not reset or re-seed.

Open the [offline evidence index](../output/playwright/capstone-2026-10-06/evidence-pack/index.html) and invoice PDF before the talk.

Recorded supported address: 100 King William Street, Adelaide SA 5000. Select the autocomplete suggestion. Recheck before presenting.

## Keep these distinctions clear

- Database-estimated coverage versus live NBN qualification.
- Stripe test mode versus live money.
- Recorded evidence versus a live demonstration.
- Prepared account/request versus one created during the talk.
- Internal-request authorization versus execution of a refund or service action.
- Approved or scheduled service request versus completed network work.

## If something stalls

“This step depends on an external service. I’ll use the saved result from the recorded test and continue with the application workflow.”

## Timing adjustments

**5 minutes:** use existing support records, omit live billing reporting, shorten architecture and introduction.

**10 minutes:** add two minutes showing one internal request move through Staff, Admin and Super Admin. If questions count toward ten minutes, use the eight-minute core and reserve two minutes.

## Closing line

“The main outcome is a connected customer and employee workflow with controlled state changes and traceable records. Thank you. I’m happy to take questions.”

[Full speaking script, slide outline and professor questions](presentation-demo-script.md)
