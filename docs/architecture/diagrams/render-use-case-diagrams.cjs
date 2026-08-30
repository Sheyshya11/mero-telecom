const fs = require('node:fs');
const path = require('node:path');

const sharpModule = process.argv[2];
if (!sharpModule) {
  throw new Error('Pass the absolute path to the bundled sharp module.');
}
const sharp = require(sharpModule);

const outputDirectory = __dirname;

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function textLines(lines, x, y, options = {}) {
  const values = Array.isArray(lines) ? lines : [lines];
  const size = options.size ?? 18;
  const lineHeight = options.lineHeight ?? size * 1.22;
  const weight = options.weight ?? 500;
  const anchor = options.anchor ?? 'middle';
  const fill = options.fill ?? '#172033';
  const startY = y - ((values.length - 1) * lineHeight) / 2;
  return `<text x="${x}" y="${startY}" text-anchor="${anchor}" dominant-baseline="middle" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${values
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('')}</text>`;
}

function actor(x, y, label) {
  return `<g aria-label="Actor ${escapeXml(label)}">
    <circle cx="${x}" cy="${y - 48}" r="18" fill="#ffffff" stroke="#263247" stroke-width="3"/>
    <line x1="${x}" y1="${y - 30}" x2="${x}" y2="${y + 28}" stroke="#263247" stroke-width="3"/>
    <line x1="${x - 30}" y1="${y - 6}" x2="${x + 30}" y2="${y - 6}" stroke="#263247" stroke-width="3"/>
    <line x1="${x}" y1="${y + 28}" x2="${x - 27}" y2="${y + 65}" stroke="#263247" stroke-width="3"/>
    <line x1="${x}" y1="${y + 28}" x2="${x + 27}" y2="${y + 65}" stroke="#263247" stroke-width="3"/>
    ${textLines(label, x, y + 110, { size: 18, weight: 600 })}
  </g>`;
}

function useCase(item) {
  const height = item.h ?? 72;
  return `<g aria-label="Use case ${escapeXml(item.lines.join(' '))}">
    <ellipse cx="${item.x}" cy="${item.y}" rx="${item.w / 2}" ry="${height / 2}" fill="#ffffff" stroke="#334155" stroke-width="2.5"/>
    ${textLines(item.lines, item.x, item.y, { size: item.size ?? 17, weight: 500 })}
  </g>`;
}

function ellipseBoundary(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const rx = from.w / 2;
  const ry = (from.h ?? 72) / 2;
  const factor = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  return { x: from.x + dx * factor, y: from.y + dy * factor };
}

function relation(from, to, label, options = {}) {
  const start = ellipseBoundary(from, to);
  const end = ellipseBoundary(to, from);
  const dashed = options.dashed ?? true;
  const marker = options.generalization ? 'url(#hollow-triangle)' : 'url(#arrowhead)';
  const color = options.generalization ? '#344054' : '#475467';
  const midX = (start.x + end.x) / 2 + (options.labelDx ?? 0);
  const midY = (start.y + end.y) / 2 + (options.labelDy ?? -13);
  const width = Math.max(92, label.length * 8.6);
  return `<g>
    <line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${color}" stroke-width="2" ${dashed ? 'stroke-dasharray="9 7"' : ''} marker-end="${marker}"/>
    <rect x="${midX - width / 2}" y="${midY - 12}" width="${width}" height="24" rx="5" fill="#ffffff" opacity="0.96"/>
    ${textLines(label, midX, midY, { size: 15, weight: 600, fill: color })}
  </g>`;
}

function association(x1, y1, x2, y2) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#667085" stroke-width="2"/>`;
}

function actorAssociation(actorPosition, item, side = 'left') {
  const target = ellipseBoundary(item, actorPosition);
  const actorStartX = side === 'left' ? actorPosition.x + 34 : actorPosition.x - 34;
  return association(actorStartX, actorPosition.y - 5, target.x, target.y);
}

function actorGeneralization(specialized, general, labelDx = 54) {
  const x = specialized.x;
  const startY = specialized.y - 72;
  const endY = general.y + 72;
  const midY = (startY + endY) / 2;
  return `<g>
    <line x1="${x}" y1="${startY}" x2="${x}" y2="${endY}" stroke="#344054" stroke-width="2.5" marker-end="url(#hollow-triangle)"/>
    ${textLines('«generalization»', x + labelDx, midY, { size: 14, weight: 600, fill: '#344054' })}
  </g>`;
}

function documentSvg({
  width,
  height,
  title,
  boundary,
  actors,
  externalActors,
  useCases,
  associations,
  relations,
  generalizations = [],
}) {
  const defs = `<defs>
    <marker id="arrowhead" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 12 6 L 0 12 z" fill="#475467"/>
    </marker>
    <marker id="hollow-triangle" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
      <path d="M 1 1 L 13 7 L 1 13 z" fill="#ffffff" stroke="#344054" stroke-width="1.6"/>
    </marker>
    <filter id="soft-shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#101828" flood-opacity="0.10"/>
    </filter>
  </defs>`;

  const boundaryMarkup = `<rect x="${boundary.x}" y="${boundary.y}" width="${boundary.w}" height="${boundary.h}" rx="8" fill="#f8fafc" stroke="#1e293b" stroke-width="3" filter="url(#soft-shadow)"/>
    <rect x="${boundary.x + 18}" y="${boundary.y + 14}" width="390" height="36" rx="5" fill="#e9eef7"/>
    ${textLines('Mero Telecom ISP Management Platform', boundary.x + 32, boundary.y + 33, { size: 17, weight: 700, anchor: 'start' })}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
    ${defs}
    <rect width="${width}" height="${height}" fill="#ffffff"/>
    ${textLines(title, width / 2, 34, { size: 25, weight: 700, fill: '#0f172a' })}
    ${boundaryMarkup}
    ${associations.join('\n')}
    ${generalizations.join('\n')}
    ${useCases.map(useCase).join('\n')}
    ${relations.join('\n')}
    ${actors.map((item) => actor(item.x, item.y, item.label)).join('\n')}
    ${externalActors.map((item) => actor(item.x, item.y, item.label)).join('\n')}
  </svg>`;
}

function diagramOne() {
  const actorVisitor = { x: 115, y: 490, label: 'Visitor' };
  const external = {
    geo: { x: 1775, y: 250, label: 'Geoapify' },
    stripe: { x: 1775, y: 570, label: 'Stripe' },
    smtp: { x: 1775, y: 820, label: ['SMTP', 'provider'] },
  };
  const uc = {
    browse: { x: 515, y: 175, w: 310, lines: ['Browse available plans'] },
    coverage: { x: 515, y: 325, w: 310, lines: ['Check service coverage'] },
    register: { x: 515, y: 525, w: 340, lines: ['Register and purchase', 'a plan'] },
    activate: { x: 515, y: 735, w: 310, lines: ['Activate customer account'] },
    recover: { x: 515, y: 895, w: 310, lines: ['Recover forgotten password'] },
    search: { x: 1090, y: 235, w: 330, lines: ['Search trusted address'] },
    compatible: { x: 1090, y: 365, w: 330, lines: ['View compatible plans'] },
    hosted: { x: 1090, y: 510, w: 330, lines: ['Complete hosted payment'] },
    payment: { x: 1090, y: 655, w: 350, lines: ['Process trusted', 'payment result'] },
    notification: { x: 1090, y: 820, w: 350, lines: ['Send activation notification'] },
  };

  return documentSvg({
    width: 1900,
    height: 1080,
    title: 'Use Case Diagram 1 — Public Acquisition and Account Activation',
    boundary: { x: 260, y: 72, w: 1300, h: 945 },
    actors: [actorVisitor],
    externalActors: [external.geo, external.stripe, external.smtp],
    useCases: Object.values(uc),
    associations: [
      actorAssociation(actorVisitor, uc.browse),
      actorAssociation(actorVisitor, uc.coverage),
      actorAssociation(actorVisitor, uc.register),
      actorAssociation(actorVisitor, uc.activate),
      actorAssociation(actorVisitor, uc.recover),
      actorAssociation(external.geo, uc.search, 'right'),
      actorAssociation(external.stripe, uc.hosted, 'right'),
      actorAssociation(external.stripe, uc.payment, 'right'),
      actorAssociation(external.smtp, uc.notification, 'right'),
    ],
    relations: [
      relation(uc.coverage, uc.search, '«include»', { labelDy: -18 }),
      relation(uc.coverage, uc.compatible, '«include»', { labelDy: 16 }),
      relation(uc.register, uc.coverage, '«include»', { labelDx: -68, labelDy: 0 }),
      relation(uc.register, uc.hosted, '«include»', { labelDy: -18 }),
      relation(uc.register, uc.payment, '«include»', { labelDy: 8 }),
      relation(uc.register, uc.notification, '«include»', { labelDy: 12 }),
    ],
  });
}

function diagramTwo() {
  const customer = { x: 115, y: 610, label: 'Customer' };
  const external = {
    stripe: { x: 1890, y: 1050, label: 'Stripe' },
    scheduler: { x: 1890, y: 820, label: ['Scheduler', '/ clock'] },
  };
  const uc = {
    session: { x: 520, y: 160, w: 325, lines: ['Manage authenticated', 'session'] },
    dashboard: { x: 520, y: 285, w: 325, lines: ['View customer dashboard'] },
    profile: { x: 520, y: 410, w: 325, lines: ['Maintain own profile'] },
    subscriptions: { x: 520, y: 535, w: 325, lines: ['View subscription history'] },
    change: { x: 520, y: 690, w: 325, lines: ['Change service plan'] },
    preview: { x: 955, y: 640, w: 325, lines: ['Preview plan change'] },
    upgrade: { x: 955, y: 765, w: 325, lines: ['Upgrade plan immediately'] },
    downgrade: { x: 955, y: 890, w: 325, lines: ['Schedule plan downgrade'] },
    cancel: { x: 520, y: 850, w: 325, lines: ['Cancel scheduled downgrade'] },
    invoices: { x: 520, y: 1020, w: 325, lines: ['View owned invoices'] },
    download: { x: 955, y: 1015, w: 325, lines: ['Download invoice PDF'] },
    pay: { x: 955, y: 1130, w: 325, lines: ['Pay owned invoice'] },
    payment: { x: 1450, y: 1050, w: 340, lines: ['Process trusted', 'payment result'] },
    apply: { x: 1450, y: 820, w: 350, lines: ['Apply due scheduled', 'downgrade'] },
  };

  return documentSvg({
    width: 2020,
    height: 1250,
    title: 'Use Case Diagram 2 — Customer Self-Service, Billing and Plan Changes',
    boundary: { x: 260, y: 72, w: 1500, h: 1120 },
    actors: [customer],
    externalActors: [external.stripe, external.scheduler],
    useCases: Object.values(uc),
    associations: [
      actorAssociation(customer, uc.session),
      actorAssociation(customer, uc.dashboard),
      actorAssociation(customer, uc.profile),
      actorAssociation(customer, uc.subscriptions),
      actorAssociation(customer, uc.change),
      actorAssociation(customer, uc.cancel),
      actorAssociation(customer, uc.invoices),
      actorAssociation(customer, uc.pay),
      actorAssociation(external.stripe, uc.payment, 'right'),
      actorAssociation(external.scheduler, uc.apply, 'right'),
    ],
    relations: [
      relation(uc.change, uc.preview, '«include»', { labelDy: -17 }),
      relation(uc.upgrade, uc.change, '«generalization»', {
        dashed: false,
        generalization: true,
        labelDy: -19,
      }),
      relation(uc.downgrade, uc.change, '«generalization»', {
        dashed: false,
        generalization: true,
        labelDy: 16,
      }),
      relation(uc.upgrade, uc.payment, '«include»', { labelDy: -18 }),
      relation(uc.pay, uc.payment, '«include»', { labelDy: 18 }),
      relation(uc.download, uc.invoices, '«extend»', { labelDy: -18 }),
      relation(uc.apply, uc.downgrade, '«extend» at effective date', { labelDy: -20 }),
    ],
  });
}

function diagramThree() {
  const actors = {
    staff: { x: 120, y: 330, label: 'Staff' },
    admin: { x: 120, y: 760, label: 'Administrator' },
    superAdmin: { x: 120, y: 1110, label: ['Super', 'administrator'] },
    invitee: { x: 120, y: 1330, label: 'Invited user' },
  };
  const smtp = { x: 2040, y: 720, label: ['SMTP', 'provider'] };
  const uc = {
    session: { x: 610, y: 155, w: 340, lines: ['Manage authenticated', 'session'] },
    customers: { x: 610, y: 300, w: 340, lines: ['Manage customer records'] },
    subscriptions: { x: 610, y: 445, w: 340, lines: ['Manage subscription', 'status and history'] },
    generate: { x: 610, y: 590, w: 340, lines: ['Generate monthly invoice'] },
    viewInvoice: { x: 610, y: 735, w: 340, lines: ['View invoice'] },
    emailInvoice: { x: 610, y: 880, w: 340, lines: ['Email invoice PDF'] },
    coverageView: {
      x: 610,
      y: 1035,
      w: 340,
      lines: ['View coverage configuration', 'and analytics'],
    },
    createCustomer: { x: 1100, y: 250, w: 350, lines: ['Create pending customer'] },
    resend: { x: 1100, y: 380, w: 350, lines: ['Resend customer activation'] },
    plans: { x: 1100, y: 525, w: 350, lines: ['Manage internet plans'] },
    coverage: { x: 1100, y: 670, w: 350, lines: ['Manage coverage rules'] },
    dashboard: { x: 1100, y: 815, w: 350, lines: ['View operational dashboard'] },
    download: { x: 1100, y: 940, w: 350, lines: ['Download invoice PDF'] },
    inviteStaff: { x: 1100, y: 1070, w: 350, lines: ['Invite staff user'] },
    manageStaff: { x: 1100, y: 1200, w: 350, lines: ['Manage staff status'] },
    notification: { x: 1540, y: 650, w: 350, lines: ['Send account notification'] },
    inviteAdmin: { x: 1540, y: 960, w: 350, lines: ['Invite administrator'] },
    privileged: { x: 1540, y: 1090, w: 350, lines: ['Manage privileged user'] },
    audit: { x: 1540, y: 1220, w: 350, lines: ['View security audit logs'] },
    accept: { x: 1100, y: 1370, w: 350, lines: ['Accept staff invitation'] },
  };

  return documentSvg({
    width: 2180,
    height: 1480,
    title: 'Use Case Diagram 3 — Staff, Administrator and Security Operations',
    boundary: { x: 300, y: 72, w: 1550, h: 1360 },
    actors: Object.values(actors),
    externalActors: [smtp],
    useCases: Object.values(uc),
    associations: [
      actorAssociation(actors.staff, uc.session),
      actorAssociation(actors.staff, uc.customers),
      actorAssociation(actors.staff, uc.subscriptions),
      actorAssociation(actors.staff, uc.generate),
      actorAssociation(actors.staff, uc.viewInvoice),
      actorAssociation(actors.staff, uc.emailInvoice),
      actorAssociation(actors.staff, uc.coverageView),
      actorAssociation(actors.admin, uc.createCustomer),
      actorAssociation(actors.admin, uc.resend),
      actorAssociation(actors.admin, uc.plans),
      actorAssociation(actors.admin, uc.coverage),
      actorAssociation(actors.admin, uc.dashboard),
      actorAssociation(actors.admin, uc.inviteStaff),
      actorAssociation(actors.admin, uc.manageStaff),
      actorAssociation(actors.superAdmin, uc.inviteAdmin),
      actorAssociation(actors.superAdmin, uc.privileged),
      actorAssociation(actors.superAdmin, uc.audit),
      actorAssociation(actors.invitee, uc.accept),
      actorAssociation(smtp, uc.notification, 'right'),
      actorAssociation(smtp, uc.emailInvoice, 'right'),
    ],
    relations: [
      relation(uc.createCustomer, uc.customers, '«extend» administrator only', { labelDy: -18 }),
      relation(uc.createCustomer, uc.notification, '«include»', { labelDy: -18 }),
      relation(uc.resend, uc.notification, '«include»', { labelDy: 16 }),
      relation(uc.download, uc.viewInvoice, '«extend»', { labelDy: -18 }),
      relation(uc.emailInvoice, uc.viewInvoice, '«include»', { labelDx: -70, labelDy: 0 }),
      relation(uc.inviteStaff, uc.notification, '«include»', { labelDy: 17 }),
      relation(uc.inviteAdmin, uc.notification, '«include»', { labelDy: 18 }),
    ],
    generalizations: [
      actorGeneralization(actors.admin, actors.staff),
      actorGeneralization(actors.superAdmin, actors.admin),
    ],
  });
}

async function render(filename, svg) {
  const svgPath = path.join(outputDirectory, `${filename}.svg`);
  const pngPath = path.join(outputDirectory, `${filename}.png`);
  fs.writeFileSync(svgPath, svg, 'utf8');
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(pngPath);
  return pngPath;
}

async function main() {
  const files = await Promise.all([
    render('use-case-1-public-acquisition', diagramOne()),
    render('use-case-2-customer-self-service', diagramTwo()),
    render('use-case-3-staff-admin-security', diagramThree()),
  ]);
  for (const file of files) console.log(file);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
