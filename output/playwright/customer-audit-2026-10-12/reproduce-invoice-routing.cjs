const { createRequire } = require('node:module');
const req = createRequire('D:/MeroTelecom/apps/api/package.json');
process.env.TS_NODE_PROJECT = 'D:/MeroTelecom/apps/api/tsconfig.json';
req('ts-node/register/transpile-only');
const { PaymentsService } = req('./src/modules/payments/payments.service.ts');
const calls = [];
const prisma = {
  invoice: { findFirst: async () => { calls.push('read plan-change invoice'); return { id: 'audit-invoice', type: 'PLAN_CHANGE', status: 'OVERDUE', purchasePlanId: 'audit-plan', customerId: 'audit-customer' }; } },
  customer: { findUnique: async () => { calls.push('read customer'); return { id: 'audit-customer', status: 'ACTIVE' }; } },
  internetPlan: { findUnique: async () => { calls.push('read target plan'); return { id: 'audit-plan', isActive: true, isPublic: true, isAvailable: true, stripePriceId: 'price_fake' }; } },
  subscription: { count: async () => { calls.push('check existing active subscription'); return 1; } }
};
// No HTTP client, real database or Stripe client is available in this reproduction.
const stripe = new Proxy({}, { get() { throw new Error('Unexpected Stripe access prohibited'); } });
const service = new PaymentsService(prisma, {}, { client: stripe }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {});
(async () => {
  try { await service.createCheckoutSession('audit-invoice', { id: 'audit-user', role: 'CUSTOMER' }); console.log(JSON.stringify({ unexpectedSuccess: true, calls })); process.exitCode = 1; }
  catch (error) { console.log(JSON.stringify({ status: error.getStatus?.(), message: error.message, calls, mode: 'isolated mocks, no network and no database writes' })); }
})();
