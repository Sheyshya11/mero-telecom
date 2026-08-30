const fs = require('node:fs');
const path = require('node:path');

const sharpPath = process.argv[2] || 'sharp';
const sharp = require(sharpPath);

const outputDir = __dirname;
const palette = {
  ink: '#172033',
  line: '#43516a',
  muted: '#64748b',
  panel: '#f8fafc',
  band: '#eef4ff',
  bandAlt: '#f5f7fb',
  classHead: '#dbeafe',
  classBody: '#ffffff',
  enumHead: '#fef3c7',
  enumBody: '#fffbeb',
  accent: '#2563eb',
};

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function linesText(lines, x, y, options = {}) {
  const {
    size = 15,
    family = "'Segoe UI', Arial, sans-serif",
    weight = 400,
    fill = palette.ink,
    anchor = 'start',
    lineHeight = 24,
  } = options;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${esc(line)}</tspan>`)
    .join('')}</text>`;
}

function classHeight(item) {
  return 58 + item.attributes.length * 25 + 18;
}

function classBox(item) {
  const h = classHeight(item);
  const headerFill = item.kind === 'enum' ? palette.enumHead : palette.classHead;
  const bodyFill = item.kind === 'enum' ? palette.enumBody : palette.classBody;
  const stereotype = item.kind === 'enum' ? '<tspan font-size="13" font-weight="400">&lt;&lt;enumeration&gt;&gt;</tspan><tspan x="' + (item.x + item.w / 2) + '" dy="18">' + esc(item.name) + '</tspan>' : esc(item.name);
  return `<g data-class="${esc(item.name)}">
    <rect x="${item.x}" y="${item.y}" width="${item.w}" height="${h}" rx="12" fill="${bodyFill}" stroke="${palette.line}" stroke-width="2.4"/>
    <path d="M ${item.x + 12} ${item.y} H ${item.x + item.w - 12} Q ${item.x + item.w} ${item.y} ${item.x + item.w} ${item.y + 12} V ${item.y + 58} H ${item.x} V ${item.y + 12} Q ${item.x} ${item.y} ${item.x + 12} ${item.y} Z" fill="${headerFill}"/>
    <line x1="${item.x}" y1="${item.y + 58}" x2="${item.x + item.w}" y2="${item.y + 58}" stroke="${palette.line}" stroke-width="2"/>
    <text x="${item.x + item.w / 2}" y="${item.y + (item.kind === 'enum' ? 21 : 36)}" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="18" font-weight="700" fill="${palette.ink}">${stereotype}</text>
    ${item.attributes
      .map((attribute, index) => linesText([attribute], item.x + 18, item.y + 86 + index * 25, { size: 14, family: "Consolas, 'Courier New', monospace" }))
      .join('')}
  </g>`;
}

function label(text, x, y, options = {}) {
  const width = options.width || Math.max(70, text.length * 8 + 18);
  const fill = options.fill || '#ffffff';
  return `<g><rect x="${x - width / 2}" y="${y - 17}" width="${width}" height="25" rx="5" fill="${fill}" stroke="#d7dee9"/><text x="${x}" y="${y}" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="13" font-weight="600" fill="${palette.muted}">${esc(text)}</text></g>`;
}

function relation(item) {
  const markerStart = item.type === 'composition' ? ' marker-start="url(#composition)"' : item.type === 'aggregation' ? ' marker-start="url(#aggregation)"' : '';
  const markerEnd = item.directed ? ' marker-end="url(#openArrow)"' : '';
  const points = item.points.map(([x, y]) => `${x},${y}`).join(' ');
  return `<g data-relation="${esc(item.name || '')}">
    <polyline points="${points}" fill="none" stroke="${palette.line}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${markerStart}${markerEnd}/>
  </g>`;
}

function band(item, width) {
  return `<rect x="42" y="${item.y}" width="${width - 84}" height="${item.h}" rx="18" fill="${item.fill}"/><text x="72" y="${item.y + 35}" font-family="'Segoe UI', Arial, sans-serif" font-size="14" font-weight="700" letter-spacing="0.7" fill="${palette.muted}">${esc(item.label.toUpperCase())}</text>`;
}

function diagramSvg(config) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${config.width}" height="${config.height}" viewBox="0 0 ${config.width} ${config.height}">
    <defs>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#0f172a" flood-opacity="0.10"/></filter>
      <marker id="openArrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M1,1 L11,6 L1,11" fill="none" stroke="${palette.line}" stroke-width="1.7"/></marker>
      <marker id="composition" viewBox="0 0 18 12" refX="1" refY="6" markerWidth="16" markerHeight="12" orient="auto"><path d="M1,6 L8,1 L15,6 L8,11 Z" fill="${palette.line}" stroke="${palette.line}"/></marker>
      <marker id="aggregation" viewBox="0 0 18 12" refX="1" refY="6" markerWidth="16" markerHeight="12" orient="auto"><path d="M1,6 L8,1 L15,6 L8,11 Z" fill="#ffffff" stroke="${palette.line}"/></marker>
    </defs>
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="${config.width / 2}" y="50" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="30" font-weight="750" fill="${palette.ink}">${esc(config.title)}</text>
    <text x="${config.width / 2}" y="82" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="15" fill="${palette.muted}">${esc(config.subtitle)}</text>
    ${config.bands.map((item) => band(item, config.width)).join('')}
    <g>${config.relations.map(relation).join('')}</g>
    <g filter="url(#shadow)">${config.classes.map(classBox).join('')}</g>
    <g>${config.relations.map((item) => `${item.label ? label(item.label.text, item.label.x, item.label.y, { width: item.label.width }) : ''}${(item.ends || []).map((end) => linesText([end.text], end.x, end.y, { size: 14, weight: 700, fill: palette.ink, anchor: end.anchor || 'middle' })).join('')}`).join('')}</g>
    <g transform="translate(${config.width - 510}, ${config.height - 45})">
      <line x1="0" y1="0" x2="70" y2="0" stroke="${palette.line}" stroke-width="2.2" marker-start="url(#composition)"/><text x="82" y="5" font-family="'Segoe UI', Arial, sans-serif" font-size="13" fill="${palette.muted}">composition</text>
      <line x1="190" y1="0" x2="260" y2="0" stroke="${palette.line}" stroke-width="2.2" marker-end="url(#openArrow)"/><text x="272" y="5" font-family="'Segoe UI', Arial, sans-serif" font-size="13" fill="${palette.muted}">directed association</text>
    </g>
  </svg>`;
}

const identity = {
  width: 1800,
  height: 1900,
  title: 'Class Diagram 1 — Identity and Customer Management',
  subtitle: 'Customer identity, addresses, authentication artefacts, invitations and audit evidence',
  bands: [
    { y: 110, h: 590, label: 'Identity and customer domain', fill: palette.bandAlt },
    { y: 720, h: 790, label: 'Security, activation and audit records', fill: palette.band },
    { y: 1530, h: 300, label: 'Enumerations referenced by the domain classes', fill: palette.bandAlt },
  ],
  classes: [
    { name: 'User', x: 120, y: 220, w: 410, attributes: ['+ id: UUID', '+ email: String {unique}', '+ displayName: String', '- passwordHash: String', '+ role: Role', '+ status: UserStatus', '+ isActive: Boolean', '+ emailVerifiedAt: DateTime?', '+ createdAt: DateTime', '+ updatedAt: DateTime'] },
    { name: 'Customer', x: 680, y: 220, w: 420, attributes: ['+ id: UUID', '+ userId: UUID? {unique}', '+ stripeCustomerId: String? {unique}', '+ customerNumber: String {unique}', '+ firstName: String', '+ lastName: String', '+ email: String {unique}', '+ phone: String', '+ status: CustomerStatus', '+ createdAt: DateTime'] },
    { name: 'CustomerAddress', x: 1240, y: 255, w: 430, attributes: ['+ id: UUID', '+ customerId: UUID', '+ type: AddressType', '+ addressLine1: String', '+ addressLine2: String?', '+ suburb: String', '+ state: String', '+ postcode: String'] },
    { name: 'RefreshSession', x: 55, y: 820, w: 350, attributes: ['+ id: UUID', '+ userId: UUID', '- tokenHash: String {unique}', '+ expiresAt: DateTime', '+ revokedAt: DateTime?', '+ createdAt: DateTime'] },
    { name: 'PasswordResetToken', x: 440, y: 820, w: 360, attributes: ['+ id: UUID', '+ userId: UUID', '- tokenHash: String {unique}', '+ expiresAt: DateTime', '+ usedAt: DateTime?', '+ revokedAt: DateTime?', '+ createdAt: DateTime'] },
    { name: 'AccountInvitation', x: 835, y: 800, w: 420, attributes: ['+ id: UUID', '+ userId: UUID', '- tokenHash: String {unique}', '+ status: InvitationStatus', '+ reason: InvitationReason', '+ createdByUserId: UUID?', '+ checkoutApplicationId: UUID?', '+ expiresAt: DateTime', '+ acceptedAt: DateTime?'] },
    { name: 'StaffInvitation', x: 1290, y: 780, w: 440, attributes: ['+ id: UUID', '+ email: String', '+ role: Role', '- tokenHash: String {unique}', '+ status: StaffInvitationStatus', '+ invitedById: UUID?', '+ acceptedById: UUID?', '+ expiresAt: DateTime', '+ acceptedAt: DateTime?', '+ revokedAt: DateTime?'] },
    { name: 'AuditLog', x: 675, y: 1260, w: 450, attributes: ['+ id: UUID', '+ actorUserId: UUID?', '+ action: String', '+ entityType: String', '+ entityId: String', '+ metadata: JSON', '+ createdAt: DateTime'] },
    { kind: 'enum', name: 'Role', x: 70, y: 1590, w: 360, attributes: ['SUPER_ADMIN', 'ADMIN', 'STAFF', 'CUSTOMER'] },
    { kind: 'enum', name: 'UserStatus', x: 500, y: 1590, w: 360, attributes: ['INVITATION_PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] },
    { kind: 'enum', name: 'CustomerStatus', x: 930, y: 1590, w: 360, attributes: ['INVITATION_PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED'] },
    { kind: 'enum', name: 'AddressType', x: 1360, y: 1590, w: 360, attributes: ['RESIDENTIAL', 'SERVICE', 'BILLING'] },
  ],
  relations: [
    { name: 'user-customer', points: [[530, 355], [680, 355]], label: { text: 'represents', x: 605, y: 335 }, ends: [{ text: '0..1', x: 550, y: 380 }, { text: '0..1', x: 660, y: 380 }] },
    { name: 'customer-address', type: 'composition', points: [[1100, 370], [1240, 370]], label: { text: 'owns by type', x: 1170, y: 345 }, ends: [{ text: '1', x: 1120, y: 400 }, { text: '0..3', x: 1218, y: 400 }] },
    { name: 'user-refresh', type: 'composition', points: [[250, 546], [250, 700], [230, 700], [230, 820]], label: { text: 'sessions', x: 230, y: 705 }, ends: [{ text: '1', x: 270, y: 575 }, { text: '0..*', x: 250, y: 800 }] },
    { name: 'user-reset', type: 'composition', points: [[325, 546], [325, 735], [620, 735], [620, 820]], label: { text: 'reset tokens', x: 475, y: 725 }, ends: [{ text: '1', x: 345, y: 575 }, { text: '0..*', x: 645, y: 800 }] },
    { name: 'user-account-invitation', type: 'composition', points: [[400, 546], [400, 765], [1045, 765], [1045, 800]], label: { text: 'activates with', x: 820, y: 755 }, ends: [{ text: '1', x: 420, y: 575 }, { text: '0..*', x: 1070, y: 788 }] },
    { name: 'user-staff-invitation', directed: true, points: [[530, 440], [1190, 440], [1190, 740], [1510, 740], [1510, 780]], label: { text: 'issues / accepts', x: 1290, y: 730 }, ends: [{ text: '0..1', x: 560, y: 430 }, { text: '0..*', x: 1540, y: 770 }] },
    { name: 'user-audit', directed: true, points: [[470, 546], [470, 1230], [900, 1230], [900, 1260]], label: { text: 'actor', x: 700, y: 1220 }, ends: [{ text: '0..1', x: 490, y: 575 }, { text: '0..*', x: 930, y: 1248 }] },
  ],
};

const commerce = {
  width: 2100,
  height: 2680,
  title: 'Class Diagram 2 — Plans, Subscriptions, Billing and Payments',
  subtitle: 'Authoritative prices, subscription history, invoices, trusted payment evidence and public checkout fulfilment',
  bands: [
    { y: 110, h: 760, label: 'Catalogue, customer subscriptions and plan changes', fill: palette.bandAlt },
    { y: 890, h: 850, label: 'Billing documents and payment evidence', fill: palette.band },
    { y: 1760, h: 850, label: 'Public checkout application and post-payment fulfilment', fill: palette.bandAlt },
  ],
  classes: [
    { name: 'Customer', x: 55, y: 210, w: 340, attributes: ['+ id: UUID', '+ customerNumber: String', '+ email: String', '+ status: CustomerStatus'] },
    { name: 'InternetPlan', x: 480, y: 180, w: 420, attributes: ['+ id: UUID', '+ name: String {unique}', '+ description: String', '+ highlights: String[]', '+ downloadMbps: Int', '+ uploadMbps: Int', '+ monthlyCents: Int', '+ isActive: Boolean', '+ isPublic: Boolean', '+ tierRank: Int'] },
    { name: 'Subscription', x: 1010, y: 180, w: 450, attributes: ['+ id: UUID', '+ customerId: UUID', '+ planId: UUID', '+ status: SubscriptionStatus', '+ startDate: Date', '+ endDate: Date?', '+ endReason: String?', '+ billingCycle: BillingCycle', '+ billingAnchorDay: Int', '+ currentPeriodStart: DateTime', '+ currentPeriodEnd: DateTime'] },
    { name: 'PlanChangeRequest', x: 1570, y: 150, w: 470, attributes: ['+ id: UUID', '+ customerId: UUID', '+ sourceSubscriptionId: UUID', '+ newSubscriptionId: UUID? {unique}', '+ sourcePlanId: UUID', '+ targetPlanId: UUID', '+ type: PlanChangeType', '+ status: PlanChangeStatus', '+ sourcePlanPriceCents: Int', '+ targetPlanPriceCents: Int', '+ unusedCreditCents: Int', '+ proratedTargetCents: Int', '+ amountPayableCents: Int', '+ effectiveAt: DateTime', '+ appliedAt: DateTime?', '+ cancelledAt: DateTime?'] },
    { name: 'InvoiceItem', x: 55, y: 1040, w: 390, attributes: ['+ id: UUID', '+ invoiceId: UUID', '+ description: String', '+ quantity: Int', '+ unitPriceCents: Int', '+ amountCents: Int'] },
    { name: 'InvoiceDocument', x: 55, y: 1390, w: 390, attributes: ['+ id: UUID', '+ invoiceId: UUID {unique}', '+ storageKey: String {unique}', '+ mimeType: String', '+ sizeBytes: Int', '+ createdAt: DateTime'] },
    { name: 'Invoice', x: 570, y: 980, w: 470, attributes: ['+ id: UUID', '+ invoiceNumber: String {unique}', '+ customerId: UUID', '+ subscriptionId: UUID?', '+ purchasePlanId: UUID?', '+ issueDate: Date', '+ dueDate: Date', '+ subtotalCents: Int', '+ taxCents: Int', '+ totalCents: Int', '+ currency: String', '+ status: InvoiceStatus', '+ issuedAt: DateTime', '+ paidAt: DateTime?'] },
    { name: 'Payment', x: 1160, y: 1010, w: 450, attributes: ['+ id: UUID', '+ invoiceId: UUID', '+ customerId: UUID', '+ provider: PaymentProvider', '+ providerPaymentId: String? {unique}', '+ providerSessionId: String? {unique}', '+ amountCents: Int', '+ currency: String', '+ status: PaymentStatus', '+ paidAt: DateTime?'] },
    { name: 'PaymentWebhookEvent', x: 1700, y: 1050, w: 360, attributes: ['+ id: UUID', '+ provider: PaymentProvider', '+ providerEventId: String {unique}', '+ eventType: String', '+ paymentId: UUID?', '+ planChangeRequestId: UUID?', '+ processedAt: DateTime'] },
    { name: 'CheckoutApplication', x: 250, y: 1860, w: 540, attributes: ['+ id: UUID', '+ planId: UUID', '+ applicantEmail: String', '+ firstName: String', '+ lastName: String', '+ phone: String', '+ residentialAddress: JSON', '+ serviceAddress: JSON', '+ billingAddress: JSON', '+ termsAcceptedAt: DateTime', '+ privacyAcceptedAt: DateTime', '+ status: CheckoutApplicationStatus', '+ amountCents: Int', '+ currency: String', '+ stripeCheckoutSessionId: String? {unique}', '+ stripePaymentIntentId: String? {unique}', '+ expiresAt: DateTime', '+ completedAt: DateTime?'] },
    { name: 'AccountInvitation', x: 920, y: 2000, w: 390, attributes: ['+ id: UUID', '+ checkoutApplicationId: UUID?', '+ status: InvitationStatus'] },
    { kind: 'enum', name: 'LifecycleStatus', x: 1450, y: 1880, w: 520, attributes: ['Subscription: PENDING | ACTIVE | SUSPENDED | CANCELLED', 'Invoice: DRAFT | ISSUED | PAID | OVERDUE | CANCELLED', 'Payment: PENDING | SUCCEEDED | FAILED | REFUNDED', 'Plan change: PENDING | CHECKOUT_CREATED | PROCESSING', 'SCHEDULED | APPLIED | FAILED | CANCELLED | EXPIRED'] },
  ],
  relations: [
    { points: [[395, 350], [450, 350], [450, 600], [980, 600], [980, 400], [1010, 400]], label: { text: 'holds subscription history', x: 715, y: 590, width: 190 }, ends: [{ text: '1', x: 420, y: 375 }, { text: '0..*', x: 990, y: 425 }] },
    { points: [[900, 360], [1010, 360]], label: { text: 'selected by', x: 955, y: 340 }, ends: [{ text: '1', x: 915, y: 385 }, { text: '0..*', x: 990, y: 385 }] },
    { points: [[1460, 420], [1570, 420]], label: { text: 'source', x: 1515, y: 400 }, ends: [{ text: '1', x: 1478, y: 445 }, { text: '0..*', x: 1550, y: 445 }] },
    { directed: true, points: [[900, 610], [1500, 610], [1500, 560], [1570, 560]], label: { text: 'source / target plans', x: 1250, y: 600, width: 160 }, ends: [{ text: '1', x: 920, y: 635 }, { text: '0..*', x: 1550, y: 585 }] },
    { directed: true, points: [[395, 400], [430, 400], [430, 720], [1760, 720], [1760, 626]], label: { text: 'requests', x: 1100, y: 710 }, ends: [{ text: '1', x: 410, y: 425 }, { text: '0..*', x: 1790, y: 650 }] },
    { type: 'composition', points: [[570, 1150], [445, 1150]], label: { text: 'contains', x: 505, y: 1128 }, ends: [{ text: '1', x: 550, y: 1178 }, { text: '1..*', x: 465, y: 1178 }] },
    { type: 'composition', points: [[570, 1430], [445, 1430]], label: { text: 'private PDF', x: 505, y: 1408 }, ends: [{ text: '1', x: 550, y: 1458 }, { text: '0..1', x: 470, y: 1458 }] },
    { points: [[1040, 1180], [1160, 1180]], label: { text: 'receives', x: 1100, y: 1158 }, ends: [{ text: '1', x: 1060, y: 1208 }, { text: '0..*', x: 1140, y: 1208 }] },
    { directed: true, points: [[1610, 1210], [1700, 1210]], label: { text: 'evidenced by', x: 1655, y: 1188 }, ends: [{ text: '0..1', x: 1630, y: 1238 }, { text: '0..*', x: 1680, y: 1238 }] },
    { directed: true, points: [[1235, 576], [1235, 900], [805, 900], [805, 980]], label: { text: 'generates', x: 970, y: 890 }, ends: [{ text: '0..1', x: 1260, y: 600 }, { text: '0..*', x: 830, y: 965 }] },
    { directed: true, points: [[1805, 626], [1805, 850], [1500, 850], [1500, 1010]], label: { text: 'adjustment / payment', x: 1640, y: 840, width: 165 }, ends: [{ text: '0..1', x: 1830, y: 650 }, { text: '0..1', x: 1525, y: 995 }] },
    { directed: true, points: [[520, 1860], [520, 1720], [690, 1720], [690, 1548]], label: { text: 'fulfils to invoice', x: 600, y: 1710, width: 140 }, ends: [{ text: '0..1', x: 545, y: 1845 }, { text: '0..1', x: 715, y: 1570 }] },
    { directed: true, points: [[790, 2110], [920, 2110]], label: { text: 'produces', x: 855, y: 2088 }, ends: [{ text: '1', x: 810, y: 2138 }, { text: '0..*', x: 900, y: 2138 }] },
    { directed: true, points: [[520, 1860], [520, 1780], [1385, 1780], [1385, 1636]], label: { text: 'fulfils to payment', x: 1050, y: 1770, width: 150 }, ends: [{ text: '0..1', x: 545, y: 1845 }, { text: '0..1', x: 1410, y: 1658 }] },
    { directed: true, points: [[480, 2080], [120, 2080], [120, 670], [690, 670], [690, 506]], label: { text: 'requested plan', x: 360, y: 660 }, ends: [{ text: '0..*', x: 455, y: 2105 }, { text: '1', x: 715, y: 530 }] },
  ],
};

const coverage = {
  width: 1900,
  height: 1920,
  title: 'Class Diagram 3 — Coverage Qualification and Plan Compatibility',
  subtitle: 'Operating regions, exact-address precedence, postcode decisions, plan rules and privacy-safe search analytics',
  bands: [
    { y: 110, h: 520, label: 'Operating geography and catalogue', fill: palette.bandAlt },
    { y: 650, h: 650, label: 'Coverage decisions and compatibility rules', fill: palette.band },
    { y: 1320, h: 520, label: 'Search evidence and supporting enumerations', fill: palette.bandAlt },
  ],
  classes: [
    { name: 'OperatingRegion', x: 560, y: 190, w: 460, attributes: ['+ id: UUID', '+ countryCode: String', '+ stateCode: String', '+ name: String', '+ status: OperatingRegionStatus', '+ createdAt: DateTime', '+ updatedAt: DateTime'] },
    { name: 'InternetPlan', x: 1330, y: 210, w: 420, attributes: ['+ id: UUID', '+ name: String', '+ downloadMbps: Int', '+ monthlyCents: Int', '+ isAvailable: Boolean'] },
    { name: 'PostcodeCoverage', x: 70, y: 740, w: 430, attributes: ['+ id: UUID', '+ operatingRegionId: UUID', '+ postcode: String', '+ status: PostcodeCoverageStatus', '+ technology: AccessTechnology?', '+ maximumSpeedMbps: Int?', '+ availabilityDate: Date?', '+ isActive: Boolean', '+ adminNotes: String?'] },
    { name: 'AddressCoverageOverride', x: 570, y: 700, w: 480, attributes: ['+ id: UUID', '+ operatingRegionId: UUID', '+ provider: String', '+ providerAddressId: String', '+ formattedAddress: String', '+ stateCode: String', '+ postcode: String', '+ status: AddressOverrideStatus', '+ technology: AccessTechnology?', '+ maximumSpeedMbps: Int?', '+ availabilityDate: Date?', '+ isActive: Boolean'] },
    { name: 'PlanCoverageRule', x: 1120, y: 720, w: 450, attributes: ['+ id: UUID', '+ planId: UUID', '+ technology: AccessTechnology', '+ minimumSpeedMbps: Int?', '+ maximumSpeedMbps: Int?', '+ operatingRegionId: UUID?', '+ postcode: String?', '+ scopeKey: String', '+ isActive: Boolean'] },
    { name: 'CoverageSearch', x: 520, y: 1390, w: 500, attributes: ['+ id: UUID', '+ requestIdentifier: UUID', '+ resultStatus: CoverageResultStatus', '+ stateCode: String?', '+ postcode: String?', '+ technology: AccessTechnology?', '+ plansReturned: Boolean', '+ operatingRegionId: UUID?', '+ customerId: UUID?', '+ createdAt: DateTime'] },
    { name: 'Customer', x: 70, y: 1450, w: 330, attributes: ['+ id: UUID', '+ customerNumber: String'] },
    { kind: 'enum', name: 'AccessTechnology', x: 1110, y: 1390, w: 360, attributes: ['FTTP', 'FTTN', 'FTTC', 'HFC', 'FIXED_WIRELESS', 'SATELLITE'] },
    { kind: 'enum', name: 'CoverageResultStatus', x: 1510, y: 1370, w: 350, attributes: ['AVAILABLE', 'COMING_SOON', 'NOT_AVAILABLE', 'OUTSIDE_REGION', 'MANUAL_REVIEW'] },
  ],
  relations: [
    { type: 'composition', points: [[660, 441], [660, 610], [285, 610], [285, 740]], label: { text: 'defines postcode decisions', x: 455, y: 600, width: 185 }, ends: [{ text: '1', x: 680, y: 465 }, { text: '0..*', x: 310, y: 725 }] },
    { type: 'composition', points: [[790, 441], [790, 700]], label: { text: 'exact-address overrides', x: 900, y: 620, width: 185 }, ends: [{ text: '1', x: 810, y: 465 }, { text: '0..*', x: 815, y: 685 }] },
    { directed: true, points: [[920, 441], [920, 560], [1345, 560], [1345, 720]], label: { text: 'optional geographic scope', x: 1140, y: 550, width: 190 }, ends: [{ text: '0..1', x: 945, y: 465 }, { text: '0..*', x: 1370, y: 705 }] },
    { type: 'composition', points: [[1540, 393], [1540, 650], [1450, 650], [1450, 720]], label: { text: 'compatibility rules', x: 1500, y: 640, width: 150 }, ends: [{ text: '1', x: 1565, y: 418 }, { text: '0..*', x: 1475, y: 705 }] },
    { directed: true, points: [[790, 441], [790, 1320], [770, 1320], [770, 1390]], label: { text: 'aggregates searches', x: 885, y: 1310, width: 145 }, ends: [{ text: '0..1', x: 815, y: 465 }, { text: '0..*', x: 795, y: 1375 }] },
    { directed: true, points: [[400, 1530], [520, 1530]], label: { text: 'performs', x: 460, y: 1508 }, ends: [{ text: '0..1', x: 420, y: 1558 }, { text: '0..*', x: 500, y: 1558 }] },
    { directed: true, points: [[500, 1000], [540, 1000], [540, 1360], [1150, 1360], [1150, 1390]], label: { text: 'technology', x: 820, y: 1350 }, ends: [] },
    { directed: true, points: [[1050, 1030], [1080, 1030], [1080, 1340], [1240, 1340], [1240, 1390]], label: { text: 'technology', x: 1160, y: 1330 }, ends: [] },
    { directed: true, points: [[1345, 1003], [1345, 1390]], label: { text: 'technology', x: 1395, y: 1280 }, ends: [] },
    { directed: true, points: [[1020, 1560], [1510, 1560]], label: { text: 'result status', x: 1265, y: 1538 }, ends: [] },
  ],
};

async function render(config, fileName) {
  const svg = diagramSvg(config);
  const svgPath = path.join(outputDir, `${fileName}.svg`);
  const pngPath = path.join(outputDir, `${fileName}.png`);
  fs.writeFileSync(svgPath, svg, 'utf8');
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
  process.stdout.write(`${pngPath}\n`);
}

(async () => {
  await render(identity, 'class-1-identity-customer');
  await render(commerce, 'class-2-subscription-billing');
  await render(coverage, 'class-3-coverage-catalogue');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
