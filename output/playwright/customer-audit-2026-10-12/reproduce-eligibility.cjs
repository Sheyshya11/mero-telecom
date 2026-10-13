const { createRequire } = require('node:module');
const req = createRequire('D:/MeroTelecom/apps/api/package.json');
process.env.TS_NODE_PROJECT = 'D:/MeroTelecom/apps/api/tsconfig.json';
req('ts-node/register/transpile-only');
const { RefundPolicyService } = req('./src/modules/refunds/refund-policy.service.ts');
const { PaymentsService } = req('./src/modules/payments/payments.service.ts');
const policy = new RefundPolicyService();
try {
  policy.assertCustomerRequestEligible({provider: 'MANUAL', providerPaymentId: 'DEMO-MANUAL-000001', status: 'SUCCEEDED', amountCents: 6900, refundedCents: 0});
  console.log(JSON.stringify({case: 'manual-refund', unexpectedSuccess: true}));
} catch (error) {
  console.log(JSON.stringify({case: 'manual-refund', status: error.getStatus(), body: error.getResponse()}));
}
const prisma = {subscription: {findFirst: async () => ({status: 'ACTIVE', billingMode: 'MANUAL', currentPeriodEnd: new Date('2026-10-01T00:00:00Z')})}};
const stripe = new Proxy({}, { get() { throw new Error('Unexpected Stripe access prohibited'); } });
const service = new PaymentsService(prisma, {}, {client: stripe}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {});
(async () => {
  try { await service.createRecurringSetupSession('audit-expired-period', {id: 'audit-user', role: 'CUSTOMER'}); console.log(JSON.stringify({case: 'expired-recurring-setup', unexpectedSuccess: true})); }
  catch (error) { console.log(JSON.stringify({case: 'expired-recurring-setup', status: error.getStatus?.(), message: error.message, mode: 'isolated mocks, no network and no database writes'})); }
})();
