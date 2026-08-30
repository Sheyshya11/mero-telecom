const fs = require('node:fs');
const path = require('node:path');

const sharpModule = process.argv[2];
if (!sharpModule) throw new Error('Pass the absolute path to the bundled sharp module.');
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
  const lineHeight = options.lineHeight ?? size * 1.25;
  const startY = y - ((values.length - 1) * lineHeight) / 2;
  return `<text x="${x}" y="${startY}" text-anchor="${options.anchor ?? 'middle'}" dominant-baseline="middle" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${options.weight ?? 500}" fill="${options.fill ?? '#172033'}">${values
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('')}</text>`;
}

function action(id, x, y, lines, options = {}) {
  return {
    id,
    type: 'action',
    x,
    y,
    w: options.w ?? 430,
    h: options.h ?? 76,
    lines,
    fill: options.fill,
  };
}

function decision(id, x, y, lines, options = {}) {
  return { id, type: 'decision', x, y, w: options.w ?? 280, h: options.h ?? 118, lines };
}

function start(id, x, y) {
  return { id, type: 'start', x, y, w: 26, h: 26, lines: [] };
}

function end(id, x, y, label) {
  return { id, type: 'end', x, y, w: 42, h: 42, lines: label ? [label] : [] };
}

function anchor(node, side) {
  if (node.type === 'start' || node.type === 'end') {
    const radius = node.w / 2;
    if (side === 'top') return { x: node.x, y: node.y - radius };
    if (side === 'bottom') return { x: node.x, y: node.y + radius };
    if (side === 'left') return { x: node.x - radius, y: node.y };
    return { x: node.x + radius, y: node.y };
  }
  if (node.type === 'decision') {
    if (side === 'top') return { x: node.x, y: node.y - node.h / 2 };
    if (side === 'bottom') return { x: node.x, y: node.y + node.h / 2 };
    if (side === 'left') return { x: node.x - node.w / 2, y: node.y };
    return { x: node.x + node.w / 2, y: node.y };
  }
  if (side === 'top') return { x: node.x, y: node.y - node.h / 2 };
  if (side === 'bottom') return { x: node.x, y: node.y + node.h / 2 };
  if (side === 'left') return { x: node.x - node.w / 2, y: node.y };
  return { x: node.x + node.w / 2, y: node.y };
}

function edge(nodes, fromId, toId, options = {}) {
  const from = nodes[fromId];
  const to = nodes[toId];
  const startPoint = anchor(from, options.from ?? 'bottom');
  const endPoint = anchor(to, options.to ?? 'top');
  const points = [startPoint, ...(options.via ?? []), endPoint];
  const color = options.color ?? '#475467';
  const pathMarkup = `<polyline points="${points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#activity-arrow)"/>`;
  let labelMarkup = '';
  if (options.label) {
    const labelPoint = options.labelAt ?? points[Math.floor(points.length / 2)];
    const width = Math.max(54, options.label.length * 9.2);
    labelMarkup = `<g><rect x="${labelPoint.x - width / 2}" y="${labelPoint.y - 15}" width="${width}" height="30" rx="6" fill="#ffffff" stroke="#d0d5dd"/><text x="${labelPoint.x}" y="${labelPoint.y}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="15" font-weight="600" fill="${color}">${escapeXml(options.label)}</text></g>`;
  }
  return { path: pathMarkup, label: labelMarkup };
}

function renderNode(node) {
  if (node.type === 'start') {
    return `<circle cx="${node.x}" cy="${node.y}" r="13" fill="#172033"/>`;
  }
  if (node.type === 'end') {
    const label = node.lines.length
      ? textLines(node.lines, node.x, node.y + 48, { size: 15, weight: 600, fill: '#475467' })
      : '';
    return `<g><circle cx="${node.x}" cy="${node.y}" r="21" fill="#ffffff" stroke="#172033" stroke-width="3"/><circle cx="${node.x}" cy="${node.y}" r="12" fill="#172033"/>${label}</g>`;
  }
  if (node.type === 'decision') {
    const points = [
      `${node.x},${node.y - node.h / 2}`,
      `${node.x + node.w / 2},${node.y}`,
      `${node.x},${node.y + node.h / 2}`,
      `${node.x - node.w / 2},${node.y}`,
    ].join(' ');
    return `<g><polygon points="${points}" fill="#fff8df" stroke="#344054" stroke-width="2.6"/>${textLines(node.lines, node.x, node.y, { size: 16, weight: 600 })}</g>`;
  }
  return `<g><rect x="${node.x - node.w / 2}" y="${node.y - node.h / 2}" width="${node.w}" height="${node.h}" rx="18" fill="${node.fill ?? '#ffffff'}" stroke="#344054" stroke-width="2.4"/>${textLines(node.lines, node.x, node.y, { size: 17, weight: 500 })}</g>`;
}

function activitySvg({ width, height, title, subtitle, nodes: nodeList, edges, phases = [] }) {
  const nodes = Object.fromEntries(nodeList.map((node) => [node.id, node]));
  const renderedEdges = edges.map((spec) => edge(nodes, spec[0], spec[1], spec[2]));
  const phaseMarkup = phases
    .map(
      (phase) =>
        `<rect x="55" y="${phase.y}" width="${width - 110}" height="${phase.h}" rx="12" fill="${phase.fill}"/><text x="78" y="${phase.y + 30}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="15" font-weight="700" fill="#475467">${escapeXml(phase.label.toUpperCase())}</text>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
    <defs>
      <marker id="activity-arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 12 6 L 0 12 z" fill="#475467"/></marker>
      <filter id="activity-shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#101828" flood-opacity="0.08"/></filter>
    </defs>
    <rect width="${width}" height="${height}" fill="#ffffff"/>
    ${textLines(title, width / 2, 36, { size: 27, weight: 700, fill: '#0f172a' })}
    ${textLines(subtitle, width / 2, 72, { size: 16, weight: 500, fill: '#667085' })}
    <rect x="40" y="100" width="${width - 80}" height="${height - 140}" rx="14" fill="#f8fafc" stroke="#1e293b" stroke-width="3" filter="url(#activity-shadow)"/>
    ${phaseMarkup}
    ${renderedEdges.map((item) => item.path).join('')}
    ${nodeList.map(renderNode).join('')}
    ${renderedEdges.map((item) => item.label).join('')}
  </svg>`;
}

function publicAcquisitionDiagram() {
  const nodes = [
    start('start', 700, 145),
    action('browse', 700, 220, ['Browse plans and select', 'a preferred service plan']),
    action('search', 700, 335, ['Search for and select a', 'trusted service address']),
    action('selection', 700, 450, [
      'Store address selection in Redis',
      'and issue an opaque token',
    ]),
    decision('token', 700, 585, ['Selection token valid', 'and unused?']),
    action('newSearch', 1110, 585, ['Reject token and require', 'a new address search'], {
      w: 360,
      fill: '#fff2f0',
    }),
    end('invalidEnd', 1110, 710, 'Invalid selection'),
    action(
      'qualify',
      700,
      735,
      ['Resolve active region, exact override,', 'postcode coverage and technology'],
      { w: 500 },
    ),
    decision('orderable', 700, 880, ['Address orderable?']),
    action(
      'unavailable',
      1110,
      880,
      ['Show unavailable, coming-soon', 'or manual-review outcome'],
      { w: 380, fill: '#fff2f0' },
    ),
    end('unavailableEnd', 1110, 1005, 'Not orderable'),
    action('compatible', 700, 1020, [
      'Filter compatible plans using',
      'technology, speed and scope rules',
    ]),
    decision('planCompatible', 700, 1160, ['Selected plan', 'compatible?']),
    action(
      'alternatives',
      280,
      1160,
      ['Show compatible alternatives', 'and let visitor reselect'],
      { w: 360, fill: '#eef4ff' },
    ),
    action(
      'context',
      700,
      1305,
      ['Issue one-use qualification and store', 'trusted checkout context in Redis'],
      { w: 500 },
    ),
    action(
      'form',
      700,
      1425,
      ['Collect applicant details, consent and', 'residential / billing address choices'],
      { w: 500 },
    ),
    action(
      'revalidate',
      700,
      1545,
      ['Consume context; revalidate address,', 'plan availability and server-side price'],
      { w: 500 },
    ),
    decision('stillValid', 700, 1690, ['Checkout context and', 'order still valid?']),
    action('reject', 1110, 1690, ['Reject checkout and require', 'fresh qualification'], {
      w: 360,
      fill: '#fff2f0',
    }),
    end('rejectEnd', 1110, 1815, 'Checkout rejected'),
    action('checkout', 700, 1840, [
      'Create CheckoutApplication and',
      'Stripe-hosted Checkout Session',
    ]),
    action('pay', 700, 1960, ['Visitor completes hosted payment']),
    decision('paid', 700, 2100, ['Payment successful?']),
    action(
      'unpaid',
      280,
      2100,
      ['Mark application failed or expired;', 'create no customer account'],
      { w: 400, fill: '#fff2f0' },
    ),
    end('unpaidEnd', 280, 2230, 'Unpaid'),
    action('webhook', 700, 2250, [
      'Verify Stripe event and execute',
      'idempotent fulfilment transaction',
    ]),
    action(
      'records',
      700,
      2370,
      [
        'Create pending User, Customer, addresses,',
        'active Subscription, paid Invoice and Payment',
      ],
      { w: 560 },
    ),
    action('email', 700, 2490, ['Queue encrypted activation email']),
    end('success', 700, 2590, 'Awaiting activation'),
  ];

  const edges = [
    ['start', 'browse'],
    ['browse', 'search'],
    ['search', 'selection'],
    ['selection', 'token'],
    [
      'token',
      'newSearch',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 910, y: 560 } },
    ],
    ['newSearch', 'invalidEnd'],
    ['token', 'qualify', { label: '[Yes]', labelAt: { x: 750, y: 665 } }],
    ['qualify', 'orderable'],
    [
      'orderable',
      'unavailable',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 910, y: 855 } },
    ],
    ['unavailable', 'unavailableEnd'],
    ['orderable', 'compatible', { label: '[Yes]', labelAt: { x: 750, y: 955 } }],
    ['compatible', 'planCompatible'],
    [
      'planCompatible',
      'alternatives',
      { from: 'left', to: 'right', label: '[No]', labelAt: { x: 490, y: 1135 } },
    ],
    [
      'alternatives',
      'browse',
      {
        from: 'top',
        to: 'left',
        via: [
          { x: 165, y: 1090 },
          { x: 165, y: 220 },
        ],
        label: 'Reselect',
        labelAt: { x: 165, y: 650 },
      },
    ],
    ['planCompatible', 'context', { label: '[Yes]', labelAt: { x: 750, y: 1235 } }],
    ['context', 'form'],
    ['form', 'revalidate'],
    ['revalidate', 'stillValid'],
    [
      'stillValid',
      'reject',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 910, y: 1665 } },
    ],
    ['reject', 'rejectEnd'],
    ['stillValid', 'checkout', { label: '[Yes]', labelAt: { x: 750, y: 1775 } }],
    ['checkout', 'pay'],
    ['pay', 'paid'],
    ['paid', 'unpaid', { from: 'left', to: 'right', label: '[No]', labelAt: { x: 490, y: 2075 } }],
    ['unpaid', 'unpaidEnd'],
    ['paid', 'webhook', { label: '[Yes]', labelAt: { x: 750, y: 2180 } }],
    ['webhook', 'records'],
    ['records', 'email'],
    ['email', 'success'],
  ];

  return activitySvg({
    width: 1400,
    height: 2660,
    title: 'Activity Diagram 1 — Coverage Qualification and Public Purchase',
    subtitle: 'No customer account or subscription exists until a trusted paid event is fulfilled',
    nodes,
    edges,
    phases: [
      { y: 120, h: 515, label: 'Address selection', fill: '#f4f7fb' },
      { y: 645, h: 620, label: 'Coverage qualification', fill: '#eef4ff' },
      { y: 1275, h: 530, label: 'Checkout validation', fill: '#f4f7fb' },
      { y: 1815, h: 775, label: 'Payment and fulfilment', fill: '#eef4ff' },
    ],
  });
}

function paymentFulfilmentDiagram() {
  const nodes = [
    start('start', 700, 145),
    action('receive', 700, 225, ['Receive raw Stripe webhook event']),
    action('signature', 700, 345, [
      'Verify Stripe-Signature using',
      'the configured test webhook secret',
    ]),
    decision('validSignature', 700, 485, ['Signature valid?']),
    action('rejectSignature', 1100, 485, ['Reject request without', 'changing business data'], {
      w: 350,
      fill: '#fff2f0',
    }),
    end('signatureEnd', 1100, 610, 'Rejected'),
    decision('supported', 700, 635, ['Supported Checkout event?']),
    action('ignore', 1100, 635, ['Acknowledge irrelevant event'], { w: 350, fill: '#f4f7fb' }),
    end('ignoredEnd', 1100, 760, 'Ignored'),
    decision('duplicate', 700, 785, ['Provider event ID', 'already recorded?']),
    action('noop', 1100, 785, ['Return idempotent success', 'without repeating side effects'], {
      w: 370,
      fill: '#f4f7fb',
    }),
    end('duplicateEnd', 1100, 910, 'Already processed'),
    action(
      'resolve',
      700,
      935,
      ['Resolve checkout kind and load trusted', 'application, invoice, payment or plan change'],
      { w: 520 },
    ),
    action(
      'validate',
      700,
      1060,
      ['Validate session ID, amount, currency,', 'metadata, ownership and current states'],
      { w: 500 },
    ),
    decision('outcome', 700, 1210, ['Stripe event outcome?']),
    action(
      'failed',
      1120,
      1160,
      ['Fail payment / request and preserve', 'the existing subscription'],
      { w: 390, fill: '#fff2f0' },
    ),
    action('recordFailure', 1120, 1290, ['Record terminal event and audit evidence'], { w: 390 }),
    end('failureEnd', 1120, 1415, 'Failed safely'),
    action('processing', 280, 1160, ['Mark payment or plan change', 'as PROCESSING'], {
      w: 360,
      fill: '#fff8df',
    }),
    action(
      'recordProcessing',
      280,
      1290,
      ['Record event and await', 'asynchronous payment result'],
      { w: 360 },
    ),
    end('processingEnd', 280, 1415, 'Awaiting result'),
    decision('safe', 700, 1395, ['Paid event still safe', 'to apply?']),
    action('review', 1160, 1530, ['Retain payment evidence and mark', 'the case REQUIRES_REVIEW'], {
      w: 390,
      fill: '#fff8df',
    }),
    action('reviewAudit', 1160, 1660, ['Record event and review audit evidence'], { w: 390 }),
    end('reviewEnd', 1160, 1785, 'Manual review'),
    action('transaction', 700, 1560, ['Begin serializable database transaction']),
    action(
      'transition',
      700,
      1695,
      [
        'Apply matching business transition:',
        'public order, initial plan, invoice payment or upgrade',
      ],
      { w: 560, h: 90 },
    ),
    action('eventAudit', 700, 1835, [
      'Insert unique webhook event and',
      'administrative audit evidence',
    ]),
    decision('commit', 700, 1980, ['Transaction committed?']),
    action('conflict', 1160, 1980, ['Retry safely or retain paid', 'case for manual review'], {
      w: 370,
      fill: '#fff8df',
    }),
    action('notify', 700, 2120, [
      'Queue deterministic encrypted activation',
      'or confirmation notification',
    ]),
    action('ack', 700, 2240, ['Return HTTP 200 to Stripe']),
    end('success', 700, 2345, 'Fulfilled once'),
  ];

  const edges = [
    ['start', 'receive'],
    ['receive', 'signature'],
    ['signature', 'validSignature'],
    [
      'validSignature',
      'rejectSignature',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 900, y: 460 } },
    ],
    ['rejectSignature', 'signatureEnd'],
    ['validSignature', 'supported', { label: '[Yes]', labelAt: { x: 750, y: 560 } }],
    [
      'supported',
      'ignore',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 900, y: 610 } },
    ],
    ['ignore', 'ignoredEnd'],
    ['supported', 'duplicate', { label: '[Yes]', labelAt: { x: 750, y: 710 } }],
    [
      'duplicate',
      'noop',
      { from: 'right', to: 'left', label: '[Yes]', labelAt: { x: 900, y: 760 } },
    ],
    ['noop', 'duplicateEnd'],
    ['duplicate', 'resolve', { label: '[No]', labelAt: { x: 750, y: 860 } }],
    ['resolve', 'validate'],
    ['validate', 'outcome'],
    [
      'outcome',
      'failed',
      { from: 'right', to: 'left', label: '[Failed / expired]', labelAt: { x: 930, y: 1140 } },
    ],
    ['failed', 'recordFailure'],
    ['recordFailure', 'failureEnd'],
    [
      'outcome',
      'processing',
      { from: 'left', to: 'right', label: '[Delayed / pending]', labelAt: { x: 455, y: 1140 } },
    ],
    ['processing', 'recordProcessing'],
    ['recordProcessing', 'processingEnd'],
    ['outcome', 'safe', { label: '[Paid]', labelAt: { x: 750, y: 1315 } }],
    ['safe', 'review', { from: 'right', to: 'left', label: '[No]', labelAt: { x: 930, y: 1465 } }],
    ['review', 'reviewAudit'],
    ['reviewAudit', 'reviewEnd'],
    ['safe', 'transaction', { label: '[Yes]', labelAt: { x: 750, y: 1485 } }],
    ['transaction', 'transition'],
    ['transition', 'eventAudit'],
    ['eventAudit', 'commit'],
    [
      'commit',
      'conflict',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 930, y: 1955 } },
    ],
    [
      'conflict',
      'reviewEnd',
      {
        from: 'bottom',
        to: 'right',
        via: [
          { x: 1280, y: 2070 },
          { x: 1320, y: 2070 },
          { x: 1320, y: 1785 },
        ],
      },
    ],
    ['commit', 'notify', { label: '[Yes]', labelAt: { x: 750, y: 2050 } }],
    ['notify', 'ack'],
    ['ack', 'success'],
  ];

  return activitySvg({
    width: 1400,
    height: 2415,
    title: 'Activity Diagram 2 — Trusted Stripe Event Fulfilment',
    subtitle:
      'Signature verification, idempotency and transaction boundaries protect every paid transition',
    nodes,
    edges,
    phases: [
      { y: 120, h: 530, label: 'Trust boundary', fill: '#f4f7fb' },
      { y: 660, h: 540, label: 'Idempotency and validation', fill: '#eef4ff' },
      { y: 1210, h: 500, label: 'Outcome handling', fill: '#f4f7fb' },
      { y: 1720, h: 625, label: 'Atomic fulfilment', fill: '#eef4ff' },
    ],
  });
}

function accountActivationSignInDiagram() {
  const nodes = [
    start('start', 700, 145),
    action('portal', 700, 220, ['Customer opens the account portal']),
    decision('activeAccount', 700, 350, ['Account already active?']),
    action('openInvitation', 300, 350, ['Open the latest account', 'activation link']),
    action('verifyInvitation', 300, 475, [
      'Hash the supplied token and load',
      'the pending invitation and user',
    ]),
    decision('invitationValid', 300, 610, ['Token valid, unused', 'and unexpired?']),
    action('invalidInvitation', 1140, 610, ['Show a neutral invalid or', 'expired-link message'], {
      w: 370,
      fill: '#fff2f0',
    }),
    action('resendInvitation', 1140, 735, [
      'Accept resend request; if eligible,',
      'revoke old links and queue a new one',
    ], { w: 390, fill: '#f4f7fb' }),
    end('awaitLink', 1140, 850, 'Awaiting a new link'),
    action('passwordSetup', 700, 790, ['Enter and confirm a new password']),
    decision('passwordValid', 700, 925, ['Password meets policy', 'and confirmation matches?']),
    action('passwordErrors', 1110, 925, ['Show validation errors', 'without consuming the link'], {
      w: 350,
      fill: '#fff2f0',
    }),
    action('activate', 700, 1070, [
      'Atomically store the bcrypt hash, consume',
      'the invitation and activate User + Customer',
    ], { w: 540, h: 88 }),
    action('activationEvidence', 700, 1205, [
      'Revoke other pending links, write audit evidence',
      'and queue the activation confirmation',
    ], { w: 560, h: 88 }),
    action('login', 700, 1340, ['Customer submits email and password']),
    action('rateLimit', 700, 1460, [
      'Apply rate limit and load the user',
      'using a normalized email address',
    ]),
    decision('credentialsValid', 700, 1605, ['Password and identity valid?']),
    action('genericFailure', 1100, 1605, [
      'Return a generic authentication error',
      'and record security evidence',
    ], { w: 390, fill: '#fff2f0' }),
    end('loginFailed', 1100, 1730, 'Sign-in denied'),
    decision('accountStatus', 700, 1770, ['Account status?']),
    action('pendingActivation', 280, 1770, ['Direct invitation-pending user', 'to account activation'], {
      w: 360,
      fill: '#fff8df',
    }),
    end('activationRequired', 280, 1835, 'Activation required'),
    action('inactiveAccount', 1120, 1770, [
      'Deny suspended or deactivated account',
      'and preserve business history',
    ], { w: 400, fill: '#fff2f0' }),
    end('inactiveEnd', 1120, 1835, 'Account unavailable'),
    action('createSession', 700, 1940, [
      'Create short-lived access token and',
      'rotating secure refresh-cookie session',
    ], { w: 500 }),
    action('dashboard', 700, 2070, ['Return role and route customer', 'to the owned dashboard']),
    decision('accessExpired', 700, 2210, ['Access token expired?']),
    end('activeSession', 280, 2210, 'Authenticated session'),
    decision('refreshValid', 700, 2370, ['Refresh cookie valid,', 'unrevoked and not reused?']),
    action('revokeSession', 1100, 2370, [
      'Revoke the session family and',
      'require password sign-in again',
    ], { w: 390, fill: '#fff2f0' }),
    end('signInAgain', 1100, 2495, 'Sign in again'),
    action('rotateSession', 700, 2510, [
      'Rotate the refresh token hash and',
      'issue a new short-lived access token',
    ], { w: 500 }),
    end('renewed', 700, 2625, 'Session renewed'),
  ];

  const edges = [
    ['start', 'portal'],
    ['portal', 'activeAccount'],
    [
      'activeAccount',
      'openInvitation',
      { from: 'left', to: 'right', label: '[No]', labelAt: { x: 500, y: 325 } },
    ],
    ['openInvitation', 'verifyInvitation'],
    ['verifyInvitation', 'invitationValid'],
    [
      'invitationValid',
      'invalidInvitation',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 690, y: 585 } },
    ],
    ['invalidInvitation', 'resendInvitation'],
    ['resendInvitation', 'awaitLink'],
    [
      'invitationValid',
      'passwordSetup',
      {
        from: 'bottom',
        to: 'left',
        via: [{ x: 300, y: 790 }],
        label: '[Yes]',
        labelAt: { x: 355, y: 765 },
      },
    ],
    ['passwordSetup', 'passwordValid'],
    [
      'passwordValid',
      'passwordErrors',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 905, y: 900 } },
    ],
    [
      'passwordErrors',
      'passwordSetup',
      {
        from: 'right',
        to: 'right',
        via: [
          { x: 1320, y: 925 },
          { x: 1320, y: 790 },
        ],
        label: '[Try again]',
        labelAt: { x: 1270, y: 855 },
      },
    ],
    ['passwordValid', 'activate', { label: '[Yes]', labelAt: { x: 750, y: 1000 } }],
    ['activate', 'activationEvidence'],
    ['activationEvidence', 'login'],
    [
      'activeAccount',
      'login',
      {
        from: 'right',
        to: 'right',
        via: [
          { x: 1310, y: 350 },
          { x: 1310, y: 1340 },
        ],
        label: '[Yes]',
        labelAt: { x: 1255, y: 390 },
      },
    ],
    ['login', 'rateLimit'],
    ['rateLimit', 'credentialsValid'],
    [
      'credentialsValid',
      'genericFailure',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 900, y: 1580 } },
    ],
    ['genericFailure', 'loginFailed'],
    ['credentialsValid', 'accountStatus', { label: '[Yes]', labelAt: { x: 750, y: 1685 } }],
    [
      'accountStatus',
      'pendingActivation',
      {
        from: 'left',
        to: 'right',
        label: '[Invitation pending]',
        labelAt: { x: 485, y: 1745 },
      },
    ],
    ['pendingActivation', 'activationRequired'],
    [
      'accountStatus',
      'inactiveAccount',
      {
        from: 'right',
        to: 'left',
        label: '[Suspended / deactivated]',
        labelAt: { x: 915, y: 1745 },
      },
    ],
    ['inactiveAccount', 'inactiveEnd'],
    ['accountStatus', 'createSession', { label: '[Active]', labelAt: { x: 750, y: 1860 } }],
    ['createSession', 'dashboard'],
    ['dashboard', 'accessExpired'],
    [
      'accessExpired',
      'activeSession',
      { from: 'left', to: 'right', label: '[No]', labelAt: { x: 490, y: 2185 } },
    ],
    ['accessExpired', 'refreshValid', { label: '[Yes]', labelAt: { x: 750, y: 2290 } }],
    [
      'refreshValid',
      'revokeSession',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 900, y: 2345 } },
    ],
    ['revokeSession', 'signInAgain'],
    ['refreshValid', 'rotateSession', { label: '[Yes]', labelAt: { x: 750, y: 2445 } }],
    ['rotateSession', 'renewed'],
  ];

  return activitySvg({
    width: 1400,
    height: 2700,
    title: 'Activity Diagram 2 — Customer Account Activation and Secure Sign-In',
    subtitle:
      'Single-use invitations, neutral failures, account-state checks and rotating sessions protect access',
    nodes,
    edges,
    phases: [
      { y: 120, h: 760, label: 'Portal entry and invitation verification', fill: '#f4f7fb' },
      { y: 890, h: 380, label: 'Password setup and activation', fill: '#eef4ff' },
      { y: 1280, h: 630, label: 'Secure sign-in and account-state checks', fill: '#f4f7fb' },
      { y: 1920, h: 710, label: 'Session creation and refresh rotation', fill: '#eef4ff' },
    ],
  });
}

function planChangeDiagram() {
  const nodes = [
    start('start', 700, 145),
    action('select', 700, 225, ['Customer selects a target plan']),
    action('preview', 700, 345, [
      'API loads owned active subscription',
      'and produces authoritative preview',
    ]),
    decision('eligible', 700, 490, ['Source and target eligible?']),
    action(
      'rejectEligibility',
      1120,
      490,
      ['Reject invalid source, target', 'or billing-period state'],
      { w: 380, fill: '#fff2f0' },
    ),
    end('eligibilityEnd', 1120, 615, 'Rejected'),
    decision('blockers', 700, 640, ['Open invoice or in-flight', 'plan change exists?']),
    action(
      'rejectBlocker',
      1120,
      640,
      ['Return conflict and keep', 'current subscription unchanged'],
      { w: 380, fill: '#fff2f0' },
    ),
    end('blockerEnd', 1120, 765, 'Blocked'),
    action(
      'calculate',
      700,
      790,
      ['Calculate source credit, target proration', 'and payable cents using integer rounding'],
      { w: 520 },
    ),
    decision('confirm', 700, 935, ['Customer confirms change?']),
    end('cancelledEarly', 1120, 935, 'No change'),
    decision('type', 700, 1085, ['Target price compared', 'with source price?']),

    action(
      'upgradeRequest',
      360,
      1240,
      ['Create upgrade request, adjustment', 'invoice and pending payment'],
      { w: 430 },
    ),
    decision('zero', 360, 1385, ['Payable amount zero?']),
    action('stripe', 360, 1530, [
      'Create or resume Stripe Checkout',
      'with deterministic idempotency key',
    ]),
    decision('payment', 360, 1680, ['Payment result?']),
    end('upgradeFailureEnd', 125, 1725, 'Upgrade not applied'),
    action(
      'validatePaid',
      360,
      1830,
      ['Validate trusted paid event, snapshots,', 'amount, metadata and current state'],
      { w: 440 },
    ),
    action(
      'applyUpgrade',
      360,
      1965,
      ['End source with PLAN_UPGRADE and create', 'active target subscription immediately'],
      { w: 470 },
    ),
    action('upgradeNotify', 360, 2090, ['Queue upgrade-applied notification']),
    end('upgradeEnd', 360, 2200, 'Upgrade applied'),

    action(
      'schedule',
      1040,
      1240,
      ['Create SCHEDULED downgrade effective', 'at currentPeriodEnd; no payment or refund'],
      { w: 470 },
    ),
    action('scheduledNotify', 1040, 1365, ['Queue scheduled-change notification']),
    decision('cancelBefore', 1040, 1510, ['Cancelled before', 'effective time?']),
    action(
      'cancelRequest',
      1430,
      1645,
      ['Mark request CANCELLED and', 'queue cancellation notification'],
      { w: 360, fill: '#f4f7fb' },
    ),
    end('downgradeCancelled', 1430, 1770, 'Downgrade cancelled'),
    action('worker', 1040, 1665, [
      'Single-concurrency worker locks',
      'the due source subscription',
    ]),
    decision('revalidate', 1040, 1810, ['Snapshots, source and', 'blockers still valid?']),
    action(
      'scheduledFailure',
      1430,
      1945,
      ['Mark request FAILED, retain history', 'and queue failure notification'],
      { w: 360, fill: '#fff2f0' },
    ),
    end('scheduledFailureEnd', 1430, 2070, 'Downgrade failed'),
    action(
      'applyDowngrade',
      1040,
      1975,
      ['End source at billing boundary and', 'create active target subscription'],
      { w: 450 },
    ),
    action('anchor', 1040, 2100, [
      'Preserve billing anchor and calculate',
      'the next monthly period',
    ]),
    action('downgradeNotify', 1040, 2225, ['Queue downgrade-applied notification']),
    end('downgradeEnd', 1040, 2335, 'Downgrade applied'),
  ];

  const edges = [
    ['start', 'select'],
    ['select', 'preview'],
    ['preview', 'eligible'],
    [
      'eligible',
      'rejectEligibility',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 910, y: 465 } },
    ],
    ['rejectEligibility', 'eligibilityEnd'],
    ['eligible', 'blockers', { label: '[Yes]', labelAt: { x: 750, y: 565 } }],
    [
      'blockers',
      'rejectBlocker',
      { from: 'right', to: 'left', label: '[Yes]', labelAt: { x: 910, y: 615 } },
    ],
    ['rejectBlocker', 'blockerEnd'],
    ['blockers', 'calculate', { label: '[No]', labelAt: { x: 750, y: 715 } }],
    ['calculate', 'confirm'],
    [
      'confirm',
      'cancelledEarly',
      { from: 'right', to: 'left', label: '[No]', labelAt: { x: 910, y: 910 } },
    ],
    ['confirm', 'type', { label: '[Yes]', labelAt: { x: 750, y: 1010 } }],
    [
      'type',
      'upgradeRequest',
      {
        from: 'left',
        to: 'top',
        via: [{ x: 360, y: 1085 }],
        label: '[Higher: upgrade]',
        labelAt: { x: 460, y: 1060 },
      },
    ],
    [
      'type',
      'schedule',
      {
        from: 'right',
        to: 'top',
        via: [{ x: 1040, y: 1085 }],
        label: '[Lower: downgrade]',
        labelAt: { x: 940, y: 1060 },
      },
    ],

    ['upgradeRequest', 'zero'],
    ['zero', 'stripe', { label: '[No]', labelAt: { x: 410, y: 1455 } }],
    ['stripe', 'payment'],
    [
      'payment',
      'upgradeFailureEnd',
      {
        from: 'left',
        to: 'right',
        via: [{ x: 125, y: 1680 }],
        label: '[Failed / expired]',
        labelAt: { x: 180, y: 1655 },
      },
    ],
    ['payment', 'validatePaid', { label: '[Paid]', labelAt: { x: 410, y: 1755 } }],
    [
      'zero',
      'applyUpgrade',
      {
        from: 'right',
        to: 'right',
        via: [
          { x: 610, y: 1385 },
          { x: 610, y: 1965 },
        ],
        label: '[Yes]',
        labelAt: { x: 610, y: 1510 },
      },
    ],
    ['validatePaid', 'applyUpgrade'],
    ['applyUpgrade', 'upgradeNotify'],
    ['upgradeNotify', 'upgradeEnd'],

    ['schedule', 'scheduledNotify'],
    ['scheduledNotify', 'cancelBefore'],
    [
      'cancelBefore',
      'cancelRequest',
      {
        from: 'right',
        to: 'top',
        via: [{ x: 1430, y: 1510 }],
        label: '[Yes]',
        labelAt: { x: 1250, y: 1485 },
      },
    ],
    ['cancelRequest', 'downgradeCancelled'],
    ['cancelBefore', 'worker', { label: '[No: boundary reached]', labelAt: { x: 1115, y: 1585 } }],
    ['worker', 'revalidate'],
    [
      'revalidate',
      'scheduledFailure',
      {
        from: 'right',
        to: 'top',
        via: [{ x: 1430, y: 1810 }],
        label: '[No]',
        labelAt: { x: 1250, y: 1785 },
      },
    ],
    ['scheduledFailure', 'scheduledFailureEnd'],
    ['revalidate', 'applyDowngrade', { label: '[Yes]', labelAt: { x: 1090, y: 1890 } }],
    ['applyDowngrade', 'anchor'],
    ['anchor', 'downgradeNotify'],
    ['downgradeNotify', 'downgradeEnd'],
  ];

  return activitySvg({
    width: 1650,
    height: 2410,
    title: 'Activity Diagram 3 — Subscription Plan Change',
    subtitle:
      'Paid upgrades apply immediately; downgrades apply safely at the stored billing boundary',
    nodes,
    edges,
    phases: [
      { y: 120, h: 930, label: 'Shared validation and preview', fill: '#f4f7fb' },
      { y: 1060, h: 1275, label: 'Upgrade and downgrade branches', fill: '#eef4ff' },
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
    render('activity-1-public-acquisition', publicAcquisitionDiagram()),
    render('activity-2-account-activation-sign-in', accountActivationSignInDiagram()),
    render('activity-3-plan-change', planChangeDiagram()),
  ]);
  for (const file of files) console.log(file);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
