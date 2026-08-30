# Requirements UML diagrams

These diagrams translate the implemented Mero Telecom requirements into views intended for
business analysis and backend design. They describe the current system scope rather than future
network provisioning, production payments, credit checks, or accounting-platform integration.

## Use-case diagram

The rectangular system boundary contains goal-oriented use cases, while every human or external
system actor remains outside it. Plain lines are associations. `«include»` points from a base use
case to required reusable behaviour, `«extend»` points from conditional behaviour to the use case
it augments, and generalization points from a specialized actor or use case to its general form.
The notation follows the actor, oval use-case, system-boundary and relationship guidance in the
[GeeksforGeeks use-case diagram reference](https://www.geeksforgeeks.org/system-design/use-case-diagram/).

```mermaid
flowchart LR
  Visitor["👤 Visitor"]
  Customer["👤 Customer"]
  Staff["👤 Staff"]
  Admin["👤 Administrator"]
  SuperAdmin["👤 Super administrator"]
  Invitee["👤 Invited user"]

  subgraph System["Mero Telecom ISP Management Platform"]
    BrowsePlans(["Browse available plans"])
    CheckCoverage(["Check service coverage"])
    SearchAddress(["Search trusted address"])
    RegisterPurchase(["Register and purchase a plan"])
    ActivateAccount(["Activate customer account"])
    Authenticate(["Manage authenticated session"])
    RecoverPassword(["Recover forgotten password"])
    AcceptStaffInvite(["Accept staff invitation"])

    ViewCustomerDashboard(["View customer dashboard"])
    MaintainProfile(["Maintain own profile"])
    ManageOwnSubscription(["View or start own subscription"])
    ChangePlan(["Change service plan"])
    UpgradePlan(["Upgrade plan immediately"])
    ScheduleDowngrade(["Schedule plan downgrade"])
    CancelDowngrade(["Cancel scheduled downgrade"])
    ViewOwnInvoices(["View or download owned invoices"])
    PayInvoice(["Pay owned invoice"])

    ManageCustomers(["Manage customer records"])
    CreatePendingCustomer(["Create pending customer"])
    ManageSubscriptions(["Manage subscription status and history"])
    GenerateInvoice(["Generate monthly invoice"])
    EmailInvoice(["Email authoritative invoice PDF"])
    ViewCoverageOperations(["View coverage configuration and analytics"])

    ManagePlans(["Manage internet plans"])
    ManageCoverage(["Manage coverage rules"])
    ViewAdminDashboard(["View operational dashboard"])
    ManageStaffUsers(["Invite or manage staff users"])
    ManagePrivilegedUsers(["Manage administrator and super-admin users"])
    ViewAuditLogs(["View security audit logs"])

    ProcessPayment(["Process trusted payment result"])
    SendAccountNotification(["Send account notification"])
    ApplyDueDowngrade(["Apply due scheduled downgrade"])
  end

  Stripe["External system: Stripe"]
  Geoapify["External system: Geoapify"]
  SMTP["External system: SMTP provider"]
  Scheduler["External actor: Scheduler / clock"]

  Visitor --- BrowsePlans
  Visitor --- CheckCoverage
  Visitor --- RegisterPurchase
  Visitor --- ActivateAccount
  Visitor --- Authenticate
  Visitor --- RecoverPassword
  Invitee --- AcceptStaffInvite

  Customer --- Authenticate
  Customer --- ViewCustomerDashboard
  Customer --- MaintainProfile
  Customer --- ManageOwnSubscription
  Customer --- ChangePlan
  Customer --- CancelDowngrade
  Customer --- ViewOwnInvoices
  Customer --- PayInvoice

  Staff --- Authenticate
  Staff --- ManageCustomers
  Staff --- ManageSubscriptions
  Staff --- GenerateInvoice
  Staff --- EmailInvoice
  Staff --- ViewCoverageOperations

  Admin --- Authenticate
  Admin --- ManageCustomers
  Admin --- ManageSubscriptions
  Admin --- GenerateInvoice
  Admin --- EmailInvoice
  Admin --- ViewCoverageOperations
  Admin --- ManagePlans
  Admin --- ManageCoverage
  Admin --- ViewAdminDashboard
  Admin --- ManageStaffUsers

  SuperAdmin -->|"«generalization»"| Admin
  SuperAdmin --- ManagePrivilegedUsers
  SuperAdmin --- ViewAuditLogs

  CheckCoverage -. "«include»" .-> SearchAddress
  RegisterPurchase -. "«include»" .-> CheckCoverage
  RegisterPurchase -. "«include»" .-> ProcessPayment
  RegisterPurchase -. "«include»" .-> SendAccountNotification
  PayInvoice -. "«include»" .-> ProcessPayment
  UpgradePlan -. "«include»" .-> ProcessPayment
  UpgradePlan -->|"«generalization»"| ChangePlan
  ScheduleDowngrade -->|"«generalization»"| ChangePlan
  ApplyDueDowngrade -. "«extend» at effective date" .-> ScheduleDowngrade
  CreatePendingCustomer -. "«extend» administrator only" .-> ManageCustomers
  CreatePendingCustomer -. "«include»" .-> SendAccountNotification
  ManageStaffUsers -. "«include» when inviting" .-> SendAccountNotification

  Geoapify --- SearchAddress
  Stripe --- ProcessPayment
  SMTP --- SendAccountNotification
  SMTP --- EmailInvoice
  Scheduler --- ApplyDueDowngrade
```

### Actor and permission interpretation

- A super administrator receives administrator capabilities through the backend authorization
  policy, then adds privileged-user and security-audit operations.
- An administrator may administer staff but may not manage another administrator or super
  administrator. A super administrator must have a recent password-authenticated session for
  sensitive super-administrator targets.
- A customer can act only on records resolved through their authenticated `User -> Customer`
  ownership mapping.
- Stripe redirects are informational. Only a signature-verified webhook or authenticated
  server-to-Stripe reconciliation can persist a successful payment transition.

## Activity diagrams

### Activity 1: Coverage qualification and new-customer purchase

This is the primary public acquisition flow. No login identity, customer, invoice, payment, or
subscription is created until Stripe reports a valid paid session.

```mermaid
flowchart TD
  Start((Start)) --> Browse["Visitor browses active, public, available plans"]
  Browse --> Enter["Enter service-address search text"]
  Enter --> Suggest["API requests normalized Geoapify suggestions"]
  Suggest --> Select{Trusted suggestion selected?}
  Select -- No --> Enter
  Select -- Yes --> StoreSelection["Store short-lived selection in Redis and return opaque token"]
  StoreSelection --> Check["Submit selected-address token for coverage check"]
  Check --> ConsumeSelection{Token exists, matches and is unused?}
  ConsumeSelection -- No --> InvalidSelection["Return expired or invalid selection; require new search"]
  InvalidSelection --> Enter
  ConsumeSelection -- Yes --> Region{Operating region active?}
  Region -- No --> Outside["Record privacy-safe search outcome and show outside-region result"]
  Outside --> StopUnavailable((End: unavailable))
  Region -- Yes --> Override{Active exact-address override exists?}
  Override -- Yes --> OverrideDecision["Use override as definitive decision"]
  Override -- No --> Postcode{Active exact-postcode rule exists?}
  Postcode -- No --> NotAvailable["Return not available"]
  Postcode -- Yes --> PostcodeDecision["Apply postcode status and technology"]
  OverrideDecision --> Orderable{Decision orderable?}
  PostcodeDecision --> Orderable
  Orderable -- No --> NonOrderable["Return unavailable, coming soon, or manual review"]
  NonOrderable --> StopUnavailable
  Orderable -- Yes --> Compatible["Filter plans using technology, speed, region and postcode rules"]
  Compatible --> AnyPlan{Selected plan compatible?}
  AnyPlan -- No --> ShowAlternatives["Show compatible plans"]
  ShowAlternatives --> Browse
  AnyPlan -- Yes --> Qualification["Issue one-use qualification token"]
  Qualification --> Context["Consume qualification; store trusted checkout context in Redis and HTTP-only cookie"]
  Context --> Form["Collect applicant contact details, consent and address relationship choices"]
  Form --> AddressChoice{Residential or billing address differs?}
  AddressChoice -- Yes --> ResolveMore["Resolve additional trusted one-use address selections"]
  AddressChoice -- No --> CopyTrusted["Copy trusted server-side address values"]
  ResolveMore --> Submit
  CopyTrusted --> Submit["Submit public plan-checkout request"]
  Submit --> ContextValid{Context present, unexpired, matched and unused?}
  ContextValid -- No --> Gone["Return 410; clear cookie and require fresh coverage check"]
  Gone --> Enter
  ContextValid -- Yes --> Requalify["Atomically consume context and re-run exact qualification"]
  Requalify --> ValidOrder{Plan still public, active, available and compatible?}
  ValidOrder -- No --> Reject["Reject order without creating business records"]
  Reject --> Browse
  ValidOrder -- Yes --> ExistingConflict{Existing identity or open application conflict?}
  ExistingConflict -- Yes --> Conflict["Return safe conflict or review outcome"]
  Conflict --> EndConflict((End: not submitted))
  ExistingConflict -- No --> Application["Create short-lived CheckoutApplication with trusted address snapshots and consent"]
  Application --> StripeSession["Create Stripe Checkout from database plan price"]
  StripeSession --> Redirect["Redirect visitor to Stripe-hosted Checkout"]
  Redirect --> Paid{Payment outcome?}
  Paid -- Cancelled, failed or expired --> NoCustomer["Mark application failed or expired; create no customer account"]
  NoCustomer --> EndFailed((End: unpaid))
  Paid -- Paid --> Webhook["Receive signed Stripe event or authenticated status reconciliation"]
  Webhook --> Verify["Continue through Activity 2: trusted payment fulfilment"]
  Verify --> EndPending((End: await activation))
```

### Activity 2: Trusted Stripe event and idempotent fulfilment

This flow is shared by public registration, an existing customer's first plan, an owned invoice
payment, and a paid upgrade.

```mermaid
flowchart TD
  Start((Stripe event received)) --> Raw["Read raw request body and Stripe-Signature header"]
  Raw --> Signature{Signature valid with configured test webhook secret?}
  Signature -- No --> Reject["Reject request; make no data changes"]
  Reject --> EndReject((End: rejected))
  Signature -- Yes --> EventType{Supported Checkout event?}
  EventType -- No --> AckIgnored["Acknowledge irrelevant event"]
  AckIgnored --> EndIgnored((End: ignored))
  EventType -- Yes --> Duplicate{Provider event ID already stored?}
  Duplicate -- Yes --> AckDuplicate["Return idempotent success"]
  AckDuplicate --> EndDuplicate((End: already processed))
  Duplicate -- No --> ResolveKind{Checkout kind from internal metadata?}

  ResolveKind -- "Public registration" --> LoadApplication["Load CheckoutApplication by trusted internal ID"]
  ResolveKind -- "Initial plan purchase" --> LoadPurchase["Load owned purchase invoice and pending payment"]
  ResolveKind -- "Existing invoice" --> LoadInvoice["Load owned issued or overdue invoice and payment"]
  ResolveKind -- "Plan upgrade" --> LoadChange["Load PlanChangeRequest, source subscription, invoice and payment"]

  LoadApplication --> Validate
  LoadPurchase --> Validate
  LoadInvoice --> Validate
  LoadChange --> Validate["Validate session ID, payment status, amount, currency, metadata, ownership and current states"]
  Validate --> PaidEvent{Successful paid event?}
  PaidEvent -- "Expired or async failure" --> FailAttempt["Fail payment/request or application and cancel adjustment invoice where applicable"]
  FailAttempt --> PreserveSource["Leave existing subscription active"]
  PreserveSource --> RecordTerminal["Record webhook event and safe audit evidence"]
  RecordTerminal --> EndFailed((End: failed safely))
  PaidEvent -- "Completed but delayed payment pending" --> Processing["Mark request/payment as processing"]
  Processing --> RecordProcessing["Record webhook event"]
  RecordProcessing --> EndProcessing((End: await async success))
  PaidEvent -- "Paid" --> Safe{All invariants still satisfied?}
  Safe -- No --> Review["Retain payment evidence and mark requires review"]
  Review --> RecordReview["Record event and audit evidence without changing service incorrectly"]
  RecordReview --> EndReview((End: manual review))
  Safe -- Yes --> Transaction["Begin serializable database transaction"]
  Transaction --> KindBranch{Fulfilment type?}

  KindBranch -- "Public registration" --> PublicWrite["Create pending User, Customer, three addresses, active Subscription, paid Invoice/items, successful Payment and AccountInvitation"]
  KindBranch -- "Initial plan" --> InitialWrite["Mark invoice/payment paid and create the customer's active Subscription"]
  KindBranch -- "Invoice payment" --> InvoiceWrite["Mark owned invoice and payment paid"]
  KindBranch -- "Upgrade" --> UpgradeWrite["Mark adjustment paid, end source Subscription and create target Subscription with preserved period end"]

  PublicWrite --> EventWrite
  InitialWrite --> EventWrite
  InvoiceWrite --> EventWrite
  UpgradeWrite --> EventWrite["Insert unique PaymentWebhookEvent and audit records"]
  EventWrite --> Commit{Transaction committed?}
  Commit -- "Serialization or uniqueness conflict" --> RetryOrReview["Retry safely or retain paid case for review"]
  RetryOrReview --> EndReview
  Commit -- Yes --> Notify{Notification required?}
  Notify -- Yes --> Queue["Queue deterministic encrypted activation or confirmation email job"]
  Notify -- No --> Ack
  Queue --> Ack["Return HTTP 200"]
  Ack --> EndSuccess((End: fulfilled once))
```

### Activity 3: Monthly invoice generation, PDF delivery and payment

```mermaid
flowchart TD
  Start((Start)) --> Actor["Admin or staff selects active subscription and optional issue date"]
  Actor --> Authorize{Authenticated and role permitted?}
  Authorize -- No --> Forbidden["Return 401 or 403"]
  Forbidden --> EndDenied((End: denied))
  Authorize -- Yes --> Load["Load subscription, customer and authoritative InternetPlan"]
  Load --> Eligible{Subscription active and billing input valid?}
  Eligible -- No --> Reject["Return validation or state conflict"]
  Reject --> EndRejected((End: rejected))
  Eligible -- Yes --> Duplicate{Invoice already exists for subscription and issue date?}
  Duplicate -- Yes --> Conflict["Return duplicate conflict; do not create second invoice"]
  Conflict --> EndRejected
  Duplicate -- No --> Calculate["Use plan monthly cents as GST-inclusive total; derive GST and subtotal in integer cents"]
  Calculate --> Create["Transactionally allocate invoice number and create ISSUED Invoice plus immutable InvoiceItem"]
  Create --> Action{Next action?}

  Action -- "Download PDF" --> PdfAuth{Role permitted or customer owns invoice?}
  PdfAuth -- No --> Forbidden
  PdfAuth -- Yes --> ExistingPdf{Private InvoiceDocument exists?}
  ExistingPdf -- Yes --> ReadObject["Read private object by internal storage key"]
  ExistingPdf -- No --> Render["Render authoritative PDF from database invoice data"]
  Render --> Production{Production storage configured?}
  Production -- Yes --> Store["Store private object and InvoiceDocument metadata"]
  Production -- No --> StreamOnly["Use rendered document without persistence"]
  Store --> Stream
  ReadObject --> Stream["Stream application/pdf with private cache policy"]
  StreamOnly --> Stream
  Stream --> EndPdf((End: PDF delivered))

  Action -- "Email PDF" --> EmailState{Invoice is issued, paid or overdue?}
  EmailState -- No --> RejectEmail["Reject draft or cancelled invoice"]
  RejectEmail --> EndRejected
  EmailState -- Yes --> SentBefore{Same invoice-recipient already audited as sent?}
  SentBefore -- Yes --> AlreadySent["Return already_sent without duplicate email"]
  AlreadySent --> EndEmail((End: idempotent))
  SentBefore -- No --> ObtainPdf["Obtain authoritative private PDF"]
  ObtainPdf --> Recipient["Resolve server-owned customer email or development redirect recipient"]
  Recipient --> Send["Send fixed template and PDF attachment through SMTP"]
  Send --> Accepted{SMTP accepted?}
  Accepted -- No --> EmailFailure["Return failure; do not claim delivery"]
  EmailFailure --> EndRejected
  Accepted -- Yes --> Audit["Write INVOICE_EMAIL_SENT audit with provider message ID"]
  Audit --> EndEmail

  Action -- "Customer pays" --> PaymentAuth{Customer owns invoice and status is ISSUED or OVERDUE?}
  PaymentAuth -- No --> Forbidden
  PaymentAuth -- Yes --> Checkout["Create or resume Stripe Checkout using stored total and currency"]
  Checkout --> Stripe["Customer completes hosted payment"]
  Stripe --> Trusted["Process through Activity 2: trusted Stripe fulfilment"]
  Trusted --> EndPaid((End: PAID))
```

### Activity 4: Customer plan change

```mermaid
flowchart TD
  Start((Start)) --> Select["Customer selects target plan for owned active subscription"]
  Select --> Preview["Request authoritative plan-change preview"]
  Preview --> Validate{Source active and monthly; target distinct, public, active and available?}
  Validate -- No --> Reject["Reject request with safe business error"]
  Reject --> EndRejected((End: rejected))
  Validate -- Yes --> Blockers{Open invoice or in-flight plan change exists?}
  Blockers -- Yes --> Conflict["Return conflict; preserve current subscription"]
  Conflict --> EndRejected
  Blockers -- No --> Period["Validate UTC period and calculate remaining duration"]
  Period --> Proration["Calculate source credit, target proration and payable cents using deterministic integer rounding"]
  Proration --> Confirm{Customer confirms target plan?}
  Confirm -- No --> EndCancelled((End: no change))
  Confirm -- Yes --> Type{Target monthly price compared with source?}

  Type -- Higher --> Upgrade["Create PENDING PlanChangeRequest, adjustment Invoice and pending Payment in serializable transaction"]
  Upgrade --> Zero{Amount payable is zero?}
  Zero -- Yes --> ApplyZero["Apply validated upgrade without Stripe"]
  Zero -- No --> CreateCheckout["Create or resume Stripe Checkout with deterministic idempotency key"]
  CreateCheckout --> CheckoutState["Mark request CHECKOUT_CREATED; keep source subscription ACTIVE"]
  CheckoutState --> Paid{Stripe result?}
  Paid -- "Cancelled, expired or failed" --> Fail["Fail request/payment, cancel adjustment invoice and preserve source"]
  Fail --> NotifyFailure["Queue failure notification"]
  NotifyFailure --> EndFailed((End: upgrade not applied))
  Paid -- "Delayed payment pending" --> Processing["Mark PROCESSING and await asynchronous result"]
  Processing --> Paid
  Paid -- Paid --> Trusted["Validate and apply through Activity 2"]
  ApplyZero --> Replace
  Trusted --> Replace["End source with PLAN_UPGRADE and create active target subscription preserving period end"]
  Replace --> NotifyApplied["Queue applied confirmation"]
  NotifyApplied --> EndApplied((End: upgrade applied))

  Type -- Lower --> Schedule["Create SCHEDULED request effective at currentPeriodEnd; no payment or refund"]
  Schedule --> NotifyScheduled["Queue scheduled confirmation; keep source ACTIVE"]
  NotifyScheduled --> BeforeBoundary{Customer cancels before effective time?}
  BeforeBoundary -- Yes --> Cancel["Mark request CANCELLED and queue cancellation notice"]
  Cancel --> EndCancelled
  BeforeBoundary -- No --> Due["Single-concurrency worker selects due request and locks source"]
  Due --> Revalidate{Snapshots, source state and blockers still valid?}
  Revalidate -- No --> FailScheduled["Mark failed and retain safe history"]
  FailScheduled --> NotifyFailure
  Revalidate -- Yes --> ApplyDown["Atomically end source with PLAN_DOWNGRADE and create active target subscription at boundary"]
  ApplyDown --> Advance["Preserve billing anchor and calculate new period end"]
  Advance --> NotifyApplied

  Type -- Same --> Reject
```

### Activity 5: Authentication, refresh rotation and password recovery

```mermaid
flowchart TD
  Start((Start)) --> Choice{Requested identity operation?}

  Choice -- Login --> Credentials["Submit email and password from trusted origin"]
  Credentials --> RateLimit{Within endpoint rate limit?}
  RateLimit -- No --> Limited["Return 429 without sensitive detail"]
  Limited --> EndFailure((End: denied))
  RateLimit -- Yes --> VerifyUser["Load User and compare bcrypt password hash"]
  VerifyUser --> Active{Credentials valid and User ACTIVE?}
  Active -- No --> GenericFail["Return generic authentication failure"]
  GenericFail --> EndFailure
  Active -- Yes --> Session["Create hashed RefreshSession; issue short-lived access token and HTTP-only refresh cookie"]
  Session --> EndLogin((End: authenticated))

  Choice -- Refresh --> Cookie["Receive HTTP-only refresh cookie from trusted origin"]
  Cookie --> CookiePresent{Cookie supplied?}
  CookiePresent -- No --> Anonymous["Return no-session response for anonymous bootstrap"]
  Anonymous --> EndNoSession((End: anonymous))
  CookiePresent -- Yes --> Hash["Hash token and load RefreshSession plus current User"]
  Hash --> RefreshValid{Unexpired, unrevoked session and active User?}
  RefreshValid -- No --> Clear["Return 401 and clear invalid cookie"]
  Clear --> EndFailure
  RefreshValid -- Yes --> Rotate["Atomically revoke old session and create replacement hash"]
  Rotate --> NewTokens["Issue new access token and replacement refresh cookie"]
  NewTokens --> EndLogin

  Choice -- Logout --> Revoke["Revoke current RefreshSession and clear cookie"]
  Revoke --> EndLogout((End: logged out))

  Choice -- ForgotPassword --> RequestReset["Submit email; always receive enumeration-safe response"]
  RequestReset --> ResetEligible{Matching active local account eligible?}
  ResetEligible -- No --> AuditNeutral["Record safe outcome; send no identifying response"]
  AuditNeutral --> EndResetRequested((End: neutral response))
  ResetEligible -- Yes --> RevokeOld["Revoke prior reset tokens and store hash of new expiring token"]
  RevokeOld --> QueueReset["Queue encrypted reset email"]
  QueueReset --> EndResetRequested
  EndResetRequested --> OpenLink["User opens reset link and submits new password"]
  OpenLink --> TokenValid{Token hash valid, unused, unrevoked and unexpired?}
  TokenValid -- No --> InvalidLink["Reject invalid or expired link"]
  InvalidLink --> EndFailure
  TokenValid -- Yes --> ResetTransaction["Atomically set bcrypt password, consume token and revoke all refresh sessions"]
  ResetTransaction --> NotifyChanged["Queue password-changed notification and write audit evidence"]
  NotifyChanged --> EndPassword((End: password changed; sign in again))
```

## Domain class diagrams

The complete domain is split into three bounded contexts so attributes and multiplicities remain
readable. These are conceptual/backend classes aligned with the Prisma model; DTOs, controllers,
guards, providers and framework classes are intentionally omitted.

### Identity and customer-management classes

```mermaid
classDiagram
  direction LR

  class User {
    +UUID id
    +String email UNIQUE
    +String displayName
    +String passwordHash
    +Role role
    +UserStatus status
    +Boolean isActive
    +DateTime emailVerifiedAt
    +DateTime createdAt
    +DateTime updatedAt
  }

  class Customer {
    +UUID id
    +UUID userId UNIQUE nullable
    +String stripeCustomerId UNIQUE nullable
    +String customerNumber UNIQUE
    +String firstName
    +String lastName
    +String email UNIQUE
    +String phone
    +CustomerStatus status
    +DateTime createdAt
    +DateTime updatedAt
  }

  class CustomerAddress {
    +UUID id
    +UUID customerId
    +AddressType type
    +String addressLine1
    +String addressLine2
    +String suburb
    +String state
    +String postcode
  }

  class RefreshSession {
    +UUID id
    +UUID userId
    +String tokenHash UNIQUE
    +DateTime expiresAt
    +DateTime revokedAt
    +DateTime createdAt
  }

  class PasswordResetToken {
    +UUID id
    +UUID userId
    +String tokenHash UNIQUE
    +DateTime expiresAt
    +DateTime usedAt
    +DateTime revokedAt
    +DateTime createdAt
  }

  class AccountInvitation {
    +UUID id
    +UUID userId
    +String tokenHash UNIQUE
    +AccountInvitationStatus status
    +AccountInvitationReason reason
    +UUID createdByUserId nullable
    +UUID checkoutApplicationId nullable
    +DateTime expiresAt
    +DateTime sentAt
    +DateTime acceptedAt
  }

  class StaffInvitation {
    +UUID id
    +String email
    +Role role
    +String tokenHash UNIQUE
    +StaffInvitationStatus status
    +UUID invitedById nullable
    +UUID acceptedById nullable
    +DateTime expiresAt
    +DateTime acceptedAt
    +DateTime revokedAt
    +DateTime sentAt
  }

  class AuditLog {
    +UUID id
    +UUID actorUserId nullable
    +String action
    +String entityType
    +String entityId
    +JSON metadata
    +DateTime createdAt
  }

  class Role {
    <<enumeration>>
    SUPER_ADMIN
    ADMIN
    STAFF
    CUSTOMER
  }

  class UserStatus {
    <<enumeration>>
    INVITATION_PENDING
    ACTIVE
    SUSPENDED
    DEACTIVATED
  }

  class CustomerStatus {
    <<enumeration>>
    INVITATION_PENDING
    ACTIVE
    INACTIVE
    SUSPENDED
  }

  class AddressType {
    <<enumeration>>
    RESIDENTIAL
    SERVICE
    BILLING
  }

  User "0..1" -- "0..1" Customer : represents
  Customer "1" *-- "0..3" CustomerAddress : owns by type
  User "1" *-- "0..*" RefreshSession : owns
  User "1" *-- "0..*" PasswordResetToken : resets with
  User "1" *-- "0..*" AccountInvitation : activates with
  User "0..1" --> "0..*" AccountInvitation : issues
  User "0..1" --> "0..*" StaffInvitation : issues
  User "0..1" <-- "0..*" StaffInvitation : accepts
  User "0..1" <-- "0..*" AuditLog : actor
  User --> Role
  User --> UserStatus
  Customer --> CustomerStatus
  CustomerAddress --> AddressType
```

Key constraints represented by this model:

- A customer may exist before login activation, but `Customer.userId` is unique when present.
- A customer has at most one address of each `AddressType`.
- Refresh, reset and invitation secrets are stored only as hashes and are independently expiring,
  revocable or consumable.
- User deactivation preserves business and audit records; it does not delete financial history.

### Plans, subscriptions, billing and payment classes

```mermaid
classDiagram
  direction LR

  class Customer {
    +UUID id
    +String customerNumber
    +String email
    +CustomerStatus status
  }

  class InternetPlan {
    +UUID id
    +String name UNIQUE
    +String description
    +String[] highlights
    +Int downloadMbps
    +Int uploadMbps
    +Int monthlyCents
    +Boolean isActive
    +Boolean isPublic
    +Boolean isAvailable
    +Int tierRank
  }

  class Subscription {
    +UUID id
    +UUID customerId
    +UUID planId
    +SubscriptionStatus status
    +Date startDate
    +Date endDate
    +String endReason
    +BillingCycle billingCycle
    +Int billingAnchorDay
    +DateTime currentPeriodStart
    +DateTime currentPeriodEnd
  }

  class PlanChangeRequest {
    +UUID id
    +UUID customerId
    +UUID sourceSubscriptionId
    +UUID newSubscriptionId UNIQUE nullable
    +UUID sourcePlanId
    +UUID targetPlanId
    +PlanChangeType type
    +PlanChangeStatus status
    +Int sourcePlanPriceCents
    +Int targetPlanPriceCents
    +Int unusedCreditCents
    +Int proratedTargetCents
    +Int amountPayableCents
    +DateTime currentPeriodStartSnapshot
    +DateTime currentPeriodEndSnapshot
    +DateTime effectiveAt
    +DateTime appliedAt
    +DateTime cancelledAt
  }

  class Invoice {
    +UUID id
    +String invoiceNumber UNIQUE
    +UUID customerId
    +UUID subscriptionId nullable
    +UUID purchasePlanId nullable
    +Date issueDate
    +Date dueDate
    +Int subtotalCents
    +Int taxCents
    +Int totalCents
    +String currency
    +InvoiceStatus status
    +DateTime issuedAt
    +DateTime paidAt
  }

  class InvoiceItem {
    +UUID id
    +UUID invoiceId
    +String description
    +Int quantity
    +Int unitPriceCents
    +Int amountCents
  }

  class InvoiceDocument {
    +UUID id
    +UUID invoiceId UNIQUE
    +String storageKey UNIQUE
    +String mimeType
    +Int sizeBytes
    +DateTime createdAt
  }

  class Payment {
    +UUID id
    +UUID invoiceId
    +UUID customerId
    +PaymentProvider provider
    +String providerPaymentId UNIQUE nullable
    +String providerSessionId UNIQUE nullable
    +Int amountCents
    +String currency
    +PaymentStatus status
    +DateTime paidAt
  }

  class PaymentWebhookEvent {
    +UUID id
    +PaymentProvider provider
    +String providerEventId UNIQUE
    +String eventType
    +UUID paymentId nullable
    +UUID planChangeRequestId nullable
    +DateTime processedAt
  }

  class CheckoutApplication {
    +UUID id
    +UUID planId
    +String applicantEmail
    +String firstName
    +String lastName
    +String phone
    +JSON residentialAddress
    +JSON serviceAddress
    +JSON billingAddress
    +DateTime termsAcceptedAt
    +DateTime privacyAcceptedAt
    +CheckoutApplicationStatus status
    +Int amountCents
    +String currency
    +String stripeCheckoutSessionId UNIQUE nullable
    +String stripePaymentIntentId UNIQUE nullable
    +DateTime expiresAt
    +DateTime completedAt
  }

  class AccountInvitation {
    +UUID id
    +UUID checkoutApplicationId nullable
    +AccountInvitationStatus status
  }

  class SubscriptionStatus {
    <<enumeration>>
    PENDING
    ACTIVE
    SUSPENDED
    CANCELLED
  }

  class InvoiceStatus {
    <<enumeration>>
    DRAFT
    ISSUED
    PAID
    OVERDUE
    CANCELLED
  }

  class PaymentStatus {
    <<enumeration>>
    PENDING
    SUCCEEDED
    FAILED
    REFUNDED
  }

  class PlanChangeStatus {
    <<enumeration>>
    PENDING
    CHECKOUT_CREATED
    PROCESSING
    SCHEDULED
    APPLIED
    FAILED
    CANCELLED
    EXPIRED
  }

  Customer "1" --> "0..*" Subscription : holds history
  InternetPlan "1" --> "0..*" Subscription : selected by
  Customer "1" --> "0..*" Invoice : billed
  Subscription "0..1" --> "0..*" Invoice : generates
  InternetPlan "0..1" --> "0..*" Invoice : purchase target
  Invoice "1" *-- "1..*" InvoiceItem : contains
  Invoice "1" *-- "0..1" InvoiceDocument : stores privately
  Invoice "1" --> "0..*" Payment : receives
  Customer "1" --> "0..*" Payment : makes
  Payment "0..1" --> "0..*" PaymentWebhookEvent : evidenced by

  InternetPlan "1" --> "0..*" CheckoutApplication : requested plan
  Customer "0..1" <-- "0..*" CheckoutApplication : fulfils to
  CheckoutApplication "0..1" --> "0..1" Subscription : fulfils to
  CheckoutApplication "0..1" --> "0..1" Invoice : fulfils to
  CheckoutApplication "0..1" --> "0..1" Payment : fulfils to
  CheckoutApplication "1" --> "0..*" AccountInvitation : produces

  Customer "1" --> "0..*" PlanChangeRequest : requests
  Subscription "1" --> "0..*" PlanChangeRequest : source
  PlanChangeRequest "0..1" --> "0..1" Subscription : result
  InternetPlan "1" <-- "0..*" PlanChangeRequest : source plan
  PlanChangeRequest "0..*" --> "1" InternetPlan : target plan
  PlanChangeRequest "0..1" --> "0..1" Invoice : adjustment
  PlanChangeRequest "0..1" --> "0..1" Payment : payment attempt
  PlanChangeRequest "0..1" --> "0..*" PaymentWebhookEvent : evidenced by

  Subscription --> SubscriptionStatus
  Invoice --> InvoiceStatus
  Payment --> PaymentStatus
  PlanChangeRequest --> PlanChangeStatus
```

Important invariants:

- Prices and all derived totals are integer Australian cents; the browser never supplies an
  authoritative amount.
- Only one active subscription is allowed per customer, and old subscriptions remain as history
  after plan changes.
- One subscription and issue-date pair can produce only one monthly invoice.
- Provider event IDs, Checkout Session IDs and Payment Intent IDs are unique idempotency evidence.
- Public checkout records consent and trusted address snapshots before payment, but creates
  customer business records only after trusted paid fulfilment.

### Coverage-management classes

```mermaid
classDiagram
  direction LR

  class OperatingRegion {
    +UUID id
    +String countryCode
    +String stateCode
    +String name
    +OperatingRegionStatus status
    +DateTime createdAt
    +DateTime updatedAt
  }

  class PostcodeCoverage {
    +UUID id
    +UUID operatingRegionId
    +String postcode
    +PostcodeCoverageStatus status
    +AccessTechnology technology nullable
    +Int maximumSpeedMbps nullable
    +Date availabilityDate nullable
    +Boolean isActive
    +String adminNotes
  }

  class AddressCoverageOverride {
    +UUID id
    +UUID operatingRegionId
    +String provider
    +String providerAddressId
    +String formattedAddress
    +String stateCode
    +String postcode
    +AddressOverrideStatus status
    +AccessTechnology technology nullable
    +Int maximumSpeedMbps nullable
    +Date availabilityDate nullable
    +Boolean isActive
    +String adminNotes
  }

  class PlanCoverageRule {
    +UUID id
    +UUID planId
    +AccessTechnology technology
    +Int minimumSpeedMbps nullable
    +Int maximumSpeedMbps nullable
    +UUID operatingRegionId nullable
    +String postcode nullable
    +String scopeKey
    +Boolean isActive
  }

  class CoverageSearch {
    +UUID id
    +UUID requestIdentifier
    +CoverageResultStatus resultStatus
    +String stateCode nullable
    +String postcode nullable
    +AccessTechnology technology nullable
    +Boolean plansReturned
    +UUID operatingRegionId nullable
    +UUID customerId nullable
    +DateTime createdAt
  }

  class InternetPlan {
    +UUID id
    +String name
    +Int downloadMbps
    +Int monthlyCents
    +Boolean isAvailable
  }

  class Customer {
    +UUID id
    +String customerNumber
  }

  class OperatingRegionStatus {
    <<enumeration>>
    ACTIVE
    COMING_SOON
    DISABLED
  }

  class AccessTechnology {
    <<enumeration>>
    FTTP
    FTTN
    FTTC
    HFC
    FIXED_WIRELESS
    SATELLITE
  }

  class CoverageResultStatus {
    <<enumeration>>
    AVAILABLE
    COMING_SOON
    NOT_AVAILABLE
    OUTSIDE_OPERATING_REGION
    MANUAL_REVIEW
  }

  OperatingRegion "1" *-- "0..*" PostcodeCoverage : defines
  OperatingRegion "1" *-- "0..*" AddressCoverageOverride : overrides
  OperatingRegion "0..1" --> "0..*" PlanCoverageRule : scopes
  InternetPlan "1" *-- "0..*" PlanCoverageRule : compatibility
  OperatingRegion "0..1" --> "0..*" CoverageSearch : aggregates
  Customer "0..1" --> "0..*" CoverageSearch : performs
  OperatingRegion --> OperatingRegionStatus
  PostcodeCoverage --> AccessTechnology
  AddressCoverageOverride --> AccessTechnology
  PlanCoverageRule --> AccessTechnology
  CoverageSearch --> CoverageResultStatus
```

Coverage decisions use this precedence:

1. The selected provider address must be resolved from a valid server-issued token.
2. An inactive or unsupported operating region stops positive qualification.
3. An active exact-address override takes precedence over postcode coverage.
4. Otherwise, the active exact-postcode decision supplies availability, technology and maximum
   speed.
5. Active plan rules filter compatible plans by technology, speed and optional geographic scope.
6. `CoverageSearch` stores analytics outcomes without the raw address or client IP.

## Traceability to backend modules

| Requirement area        | Primary NestJS modules             | Authoritative classes                                       |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------- |
| Identity and sessions   | Auth, System Users, Access Control | `User`, `RefreshSession`, `PasswordResetToken`, invitations |
| Customer operations     | Customers                          | `Customer`, `CustomerAddress`, `User`, `AccountInvitation`  |
| Coverage qualification  | Coverage                           | `OperatingRegion`, postcode/override/rule/search classes    |
| Plans and subscriptions | Plans, Subscriptions, Plan Changes | `InternetPlan`, `Subscription`, `PlanChangeRequest`         |
| Billing documents       | Billing, Invoices                  | `Invoice`, `InvoiceItem`, `InvoiceDocument`                 |
| Payment fulfilment      | Payments                           | `Payment`, `PaymentWebhookEvent`, `CheckoutApplication`     |
| Email side effects      | Notifications                      | Invitation/reset source records plus encrypted Redis jobs   |
| Operational reporting   | Dashboard, Cache                   | PostgreSQL aggregates and short-lived Redis cache           |
