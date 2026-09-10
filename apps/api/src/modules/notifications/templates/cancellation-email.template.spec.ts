import {
  renderCancellationEmail,
  renderCancellationOperationalAlert,
} from './cancellation-email.template';

describe('cancellation email templates', () => {
  const base = {
    brandLogoUrl: 'https://example.test/brand/logo.png',
    requestNumber: 'CAN-2026-00042',
    customerName: 'Subham',
    planName: 'NBN 100/20',
    effectiveAt: new Date('2026-10-09T00:00:00.000Z'),
    dashboardUrl: 'https://example.test/customer/subscription',
    providerOperation: 'DISCONNECT_SERVICE' as const,
    providerSimulated: true,
  };

  it('clearly labels a mock completion as a simulation, not an NBN disconnection', () => {
    const rendered = renderCancellationEmail({ ...base, event: 'COMPLETED' });

    expect(rendered.subject).toContain('completed');
    expect(rendered.text).toContain('internal disconnection simulation');
    expect(rendered.text).toContain('not confirmation of a real NBN or wholesale disconnection');
    expect(rendered.html).toContain('Cancellation simulation completed');
  });

  it('marks operational failure alerts as internal and confidential', () => {
    const rendered = renderCancellationOperationalAlert({
      brandLogoUrl: base.brandLogoUrl,
      requestNumber: base.requestNumber,
      customerName: base.customerName,
      planName: base.planName,
      reason: 'Mock provider failure',
      operationsUrl: 'https://example.test/admin/cancellations/CAN-2026-00042',
      providerSimulated: true,
    });

    expect(rendered.html).toContain('INTERNAL');
    expect(rendered.html).toContain('NOT CUSTOMER VISIBLE');
    expect(rendered.text).toContain('Mock provider failure');
  });

  it('uses order-withdrawal wording for a pending activation', () => {
    const rendered = renderCancellationEmail({
      ...base,
      event: 'REQUESTED',
      providerOperation: 'WITHDRAW_ACTIVATION',
    });

    expect(rendered.subject).toContain('withdrawal received');
    expect(rendered.text).toContain('withdraw your pending service order');
    expect(rendered.html).not.toContain('Service end</');
  });
});
