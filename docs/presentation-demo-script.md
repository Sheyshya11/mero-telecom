# Mero Telecom: professor demonstration and speaking script

Prepared 12 October 2026. Recommended duration: 8 minutes, excluding questions.

## Demonstration idea

**Title: Mero Telecom: customer self-service and ISP operations**

Tell one customer story: a household checks its address, chooses internet, pays, manages its account and asks for help. Then switch to the employee workspace to show how that help reaches the right person and how service changes require review.

The academic point is that customer actions connect to controlled business workflows, financial records and backend permissions. Explain why each screen exists instead of reading every field.

Use the running app for coverage, the customer account and employee operations. Use a clearly labelled screenshot of a previously completed Stripe sandbox checkout to keep signup within the time limit. Continue with a prepared customer account, explicitly identifying it as a demonstration checkpoint rather than pretending to create it during the talk.

## Eight-minute running order

| Time | Screen or material | What the audience should understand |
| --- | --- | --- |
| 0:00–0:45 | Title and public website | Problem, users and project scope |
| 0:45–1:45 | Coverage and compatible plans | Address qualification before signup |
| 1:45–2:35 | Checkout and recorded payment evidence | Payment confirmation controls activation |
| 2:35–3:45 | Customer Overview, My Internet and Invoices | Connected subscription and billing records |
| 3:45–5:05 | Customer Support, then employee Support/Internal Requests | Customer communication and internal accountability |
| 5:05–6:05 | Employee cancellation or relocation review | Requested, approved and completed are distinct |
| 6:05–7:00 | Billing report and architecture slide | Financial definitions and technical design |
| 7:00–8:00 | Test evidence, limitations and conclusion | What has been demonstrated and what remains simulated |

## Word-for-word script and screen actions

Read the quoted passages aloud. The action notes are for you. The time allowance includes navigation and pointing to results, so avoid adding lengthy explanations between passages.

### 1. Introduction, 0:00–0:45

**Show:** title, then the public website. Use `/website` if an authenticated session redirects `/` to its dashboard.

> Good morning. Today I’m presenting Mero Telecom, an academic full-stack prototype for managing a small Australian internet service provider.
>
> The problem I’m addressing is how to connect customer signup and account management with the work employees perform behind the scenes. A customer needs to understand their service and bills, while employees need controlled ways to handle requests.
>
> I’ll demonstrate a customer journey, then switch to the employee workspace to explain the business rules behind it.

### 2. Coverage and plans, 0:45–1:45

**Do:** open the address checker. Type `100 King William Street, Adelaide SA 5000`, select the recognised autocomplete suggestion and run the check. Point to the result and compatible plans. Rehearse the address against the current database first: it returned available in the recorded acceptance test, but current fixtures may differ. Use a rehearsed supported address if necessary.

> The journey begins with an address check. The customer selects a recognised address, and the application checks its configured coverage records before presenting compatible plans.
>
> This is useful because signup should depend on the service address, rather than simply allowing every customer to buy every plan. The backend validates the selected address and plan combination.
>
> Address suggestions come from Geoapify. Coverage itself is a database estimate in this prototype, so this result does not claim live NBN service qualification.

**Point to:** one plan’s actual name, speed and monthly price. Read the values on the screen rather than memorising a price.

### 3. Signup and payment, 1:45–2:35

**Show:** the selected plan’s signup/checkout step, then the saved Stripe sandbox checkout and paid-subscription screenshots. Label these as previously recorded evidence. Do not spend the core demo typing an entire signup form or waiting for activation email.

> Once the address qualifies, the customer can proceed with a compatible plan and complete Stripe Checkout in test mode.
>
> These screenshots show a previously tested checkout and its resulting paid subscription. The important rule is that returning from the payment page is not enough to activate an account. The backend verifies Stripe’s signed payment event and records the payment, invoice and subscription together. A new customer then receives an account activation link.
>
> I’ll now continue with a prepared customer account to show the account experience.

### 4. Customer account and invoices, 2:35–3:45

**Do:** switch to the prepared customer session. Show `/customer/dashboard`, open **My Internet** at `/customer/subscription`, then **Invoices** at `/customer/invoices`. Open one existing invoice PDF, then return. Use an account with an active subscription and a paid invoice.

> The customer overview brings together the service and latest billing information. My Internet provides subscription management, including plan options and automatic-payment controls where applicable.
>
> In the invoice history, the customer can see invoice status separately from payment status and download their invoice document.
>
> Behind this screen, the application calculates money in integer cents to avoid floating-point rounding errors. Invoice downloads also require authorization and ownership checks, so a customer cannot retrieve another customer’s invoice by changing its identifier.
>
> This connects the interface to financial accuracy and data privacy.

### 5. Support and employee handoff, 3:45–5:05

**Do:** open `/customer/support`, click **Contact Support**, choose **Billing**, use the prepared text below and click **Submit Request**. Point to the new reference. Switch to a separate staff browser profile at `/control-centre/support`, refresh, find the same case and open it. Point out the linked internal-request action. Show a prepared linked internal request if creating one would exceed the time budget.

- Subject: `Demo: explanation of monthly invoice`
- Message: `This is an academic demonstration using test data. Please explain the billing period shown on my latest invoice.`

> If the customer needs help, they can submit a support request and track it by its reference. I’m creating a billing question using test data.
>
> Now I’m switching to the employee workspace. The same case is available to staff, which connects the customer’s question to an operational record.
>
> When a matter needs administrative authority, staff can create a linked internal request. Administrators can review it and escalate it to a super administrator when necessary. The request retains its context and history.
>
> Customer communication and private internal discussion have different visibility. Each role receives the access needed for its responsibilities.

**If showing a prepared request:** say “This prepared linked request shows the next stage of the workflow.” Do not imply it is the request you just created.

### 6. Service requests and review, 5:05–6:05

**Do:** switch to the prepared Admin session. Open `/control-centre/cancellations` or `/control-centre/relocations` and show one pending request. Point to review status, requested date and decision controls. Use an existing scheduled request as the second checkpoint. Avoid executing a cancellation during the main talk.

> Service changes also have an approval boundary. Here, a customer’s cancellation or moving-home request enters employee review.
>
> Submitting a request leaves the current service unchanged. An authorized employee reviews it, and approval can schedule later processing. A scheduled request is still different from a completed request.
>
> This matters because an intention to cancel or move should not immediately disconnect service or rewrite the active service address. The system records the decision and separates it from operational completion.
>
> The network-provider integration is simulated in this prototype, so I’m demonstrating the workflow rather than a physical connection change.

### 7. Reporting and architecture, 6:05–7:00

**Show:** `/control-centre/billing` in the Admin session. Point to payments received and outstanding balances. Then show the simple architecture slide described below.

> The billing view helps administrators distinguish amounts billed, payments received, refunds and outstanding balances. These figures answer different questions, so the application reports them separately.
>
> Technically, the frontend uses Next.js and the backend uses NestJS. PostgreSQL stores the authoritative business records, while Redis supports caching and background email jobs.
>
> I chose a modular monolith to keep deployment manageable while separating feature responsibilities. The API enforces permissions and business rules, including checks that the browser interface alone cannot guarantee.

### 8. Evidence, limitations and closing, 7:00–8:00

**Show:** the saved evidence index or a test-results slide. Explain that these are recorded results from 6 October UTC / 7 October Adelaide, not a fresh execution during this presentation.

> To evaluate the application, the recorded browser and API acceptance run covered role access, coverage, sandbox payment, duplicate invoice prevention, request review, support escalation and notifications. That run recorded 30 passing API and database assertions. Seven assignment cases passed within their stated scope, and relocation was a partial pass because the network-provider operations were simulated.
>
> The current prototype supports the administrative and customer workflows, but payments remain in Stripe test mode and live wholesale network integration is future work. Broader production readiness would also need stronger authentication and operational monitoring.
>
> The main outcome is a connected customer and employee workflow with controlled state changes and traceable records. Thank you. I’m happy to take questions.

## Five-minute version

Use this order and keep the live browser work to two sessions: customer and Admin. Explain the staff handoff using a prepared screenshot.

| Time | Content |
| --- | --- |
| 0:00–0:30 | Introduction: problem and project scope |
| 0:30–1:10 | One successful coverage check and compatible plans |
| 1:10–1:35 | Recorded Stripe checkout and signed-webhook explanation |
| 1:35–2:25 | Prepared customer account, subscription and invoice PDF |
| 2:25–3:25 | Existing support case and linked employee request |
| 3:25–4:15 | Pending service request and approval boundary |
| 4:15–5:00 | Architecture, recorded evidence, limitations and conclusion |

Do not create a support request in this version. Use existing records and shorten each passage to its first two sentences. Skip the live billing report and describe its purpose in one sentence.

## Ten-minute version

Keep the eight-minute core and add only one two-minute demonstration:

**Recommended addition: support escalation through the role hierarchy.** Use separate prepared Staff, Admin and Super Admin browser profiles. Open the same linked internal request, demonstrate the allowed ownership/review actions, then escalate it and show its history in the Super Admin session. Complete or rehearse all prerequisite fields beforehand. Explain that internal approval records authorization and does not itself execute a refund or another underlying financial operation.

**Alternative addition: duplicate invoice protection.** Use a rehearsed active subscription with manual billing. Show that the same month's invoice already exists and that the UI offers the existing invoice rather than a second one. Do not use a Stripe-recurring subscription for manual invoice generation because the API blocks it. Reference the recorded concurrent-request test instead of inventing a browser concurrency demonstration.

If the allocated ten minutes includes questions, give the eight-minute core and reserve two minutes for discussion.

## Minimal slide outline

Use four slides and spend most of the time in the app. The script does not require a slide deck to work.

1. **Mero Telecom** — subtitle: Customer self-service and ISP operations. Add your name, course and presentation date.
2. **Project scope and users** — one sentence describing the problem, followed by Customer, Staff, Admin and Super Admin responsibilities. Keep the details in your speech.
3. **System architecture** — show the browser using Next.js, the NestJS API, and PostgreSQL. Add Redis and the external integrations as supporting services. Label Stripe as test mode and the wholesale provider as simulated.
4. **Evaluation and next steps** — recorded acceptance results, scope of the partial relocation result, and future live qualification/provisioning work. State the evidence date.

Have slide 1 ready for the introduction, slide 3 for the technical explanation, and slide 4 for the close. Avoid explaining the complete database schema within this short presentation.

## Before presenting

- Rehearse once with a timer and finish the core in about eight minutes. Allow actual time for browser navigation.
- Use separate browser profiles or separate browsers for Customer, Staff and Admin. Tabs within one profile share login cookies and can change each other's session. Add Super Admin only for the ten-minute escalation extension.
- Keep the public site in a signed-out profile, or open `/website` to avoid the authenticated homepage redirect.
- Prepare an active customer subscription, a paid invoice PDF, a linked internal request and a pending or scheduled cancellation/relocation. Note their actual references privately.
- Recheck the coverage address and plan against the current database. Do not assume the historical evidence fixtures still exist locally.
- If local services are needed, follow the repository setup already used for this environment. Check the frontend, API, PostgreSQL and Redis before the talk. Confirm Geoapify and Stripe availability if you plan to use them live.
- Complete any new signup, payment and activation rehearsal ahead of time. Keep screenshots for payment and email stages. Use only test data and the configured test delivery mailbox.
- Do not reset or re-seed the database before presenting. The current demo seed deletes existing records. Prepare the required records through ordinary workflows instead.
- Open the invoice PDF and evidence index ahead of time. Keep a local copy of the backup material available.
- Hide credentials, tokens, personal messages and unrelated tabs. Increase browser zoom enough for the room to read it.
- Do not describe the public homepage's decorative speed figures as measured network performance. The app does not demonstrate live speed monitoring.

## Recovery lines

**If an external call stalls:**

> This step depends on an external service. I’ll use the saved result from the recorded test and continue with the application workflow.

**If an expected record is unavailable:**

> I’ll switch to the prepared example of this stage so I can show the status and business rule clearly.

**If a payment has not reconciled yet:**

> The application waits for verified payment confirmation. I’ll show the recorded completed flow instead of treating this pending state as success.

Move on after about ten seconds of an unexplained stall. Avoid debugging configuration in front of the audience.

## Likely professor questions and suggested answers

**What is your main contribution?**

> The project connects public signup, customer account management and employee operations through backend business rules. The contribution includes the working workflows, the data model, authorization and evaluation evidence. I would highlight the parts I personally implemented and explain any tools or assistance used accurately.

**Why a modular monolith rather than microservices?**

> It fits the project scale and keeps transactions and deployment manageable. Feature modules separate responsibilities without adding distributed-service coordination.

**What stops a customer from accessing someone else's invoice?**

> Authentication identifies the user, and backend ownership checks scope invoice access to that customer. Document retrieval passes through authorization rather than relying on a hidden link.

**How do you prevent duplicate payment processing?**

> The backend verifies Stripe signatures and persists provider event identifiers. Idempotent processing and database transactions prevent replayed events from creating duplicate business records.

**Does a Checkout success page prove the customer paid?**

> No. The backend needs verified Stripe payment evidence. The return page alone cannot authorize account or subscription activation.

**Does approval of an internal request automatically refund money?**

> No. Internal-request approval records authorization. The underlying refund or operational workflow remains separate and applies its own controls.

**Does moving home immediately change the active service address?**

> No. Submission creates a request for review. The authoritative service change occurs at the activation stage, and full completion still depends on the old-service disconnection outcome.

**Is coverage connected to real NBN serviceability?**

> Address lookup uses Geoapify, but qualification uses configured database records. Live wholesale qualification and provisioning remain future integrations.

**Are automatic payments implemented?**

> The current app supports Stripe recurring billing in test mode. Stripe executes recurring charges, while Mero Telecom mirrors verified events into local subscription, invoice and payment records. Some existing demonstration subscriptions use manual billing.

**What does the test evidence prove?**

> The recorded run demonstrates specific browser, API and database outcomes in an isolated test environment. It does not establish production readiness or live network provisioning. I distinguish those tests from unit tests that use mocked dependencies.

**What would you improve next?**

> I would prioritise live wholesale qualification and provisioning, stronger authentication such as MFA, and production monitoring and recovery procedures before handling real services and customer data.

## Source and backup notes

This script was prepared from repository code, current workflow documents and recorded acceptance evidence. The application was not launched or retested while preparing this script. Confirm the live environment in rehearsal.

Some general README/limitations passages predate recurring billing, support, refunds and later operational features. This script uses the newer feature documentation and current routes for those areas.

- [Project overview](../README.md)
- [Current portal navigation](../apps/web/src/features/dashboard/portal-shell.tsx)
- [Role routes and workspace selection](../apps/web/src/features/auth/auth-navigation.ts)
- [Customer support form](../apps/web/src/features/support/customer-support.tsx)
- [Internal-request review and escalation](../apps/web/src/features/internal-requests/internal-request-detail.tsx)
- [Service request review](service-request-review.md)
- [Recurring test billing](stripe-recurring-billing.md)
- [Billing report definitions](billing-reporting.md)
- [Manual invoice controls](../apps/api/src/modules/invoices/invoices.service.ts)
- [Billing calculations](../apps/api/src/modules/billing/billing.service.ts)
- [Recorded acceptance evidence and scope](../output/playwright/capstone-2026-10-06/evidence-pack/README.md)
- [Offline screenshot browser](../output/playwright/capstone-2026-10-06/evidence-pack/index.html)

For the checkout backup, use `TC03/TC03-b-stripe-sandbox-checkout.png` and `TC03/TC03-c-paid-active-subscription.png` inside the evidence pack. The latter was captured before a later cancellation request changed that subscription's state. Present the screenshots as historical checkpoints.
