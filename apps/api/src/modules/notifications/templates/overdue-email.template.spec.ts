import {
  overdueCommunication,
  renderOverdueEmail,
  type OverdueEmailData,
} from './overdue-email.template';

const data: OverdueEmailData = {
  event: 'FIRST_REMINDER',
  brandLogoUrl: 'https://mero.test/logo.png',
  customerName: 'Sam <Customer>',
  invoiceNumber: 'INV-001',
  amountCents: 7990,
  currency: 'AUD',
  dueDate: new Date('2026-10-01T00:00:00Z'),
  gracePeriodEndsAt: new Date('2026-10-08T00:00:00Z'),
  dashboardUrl: 'https://mero.test/customer/invoices?invoiceId=invoice-1',
};
describe('Overdue escalation communication', () => {
  it.each([
    [
      'FIRST_REMINDER',
      'Payment reminder — Invoice INV-001 is overdue',
      'Payment overdue',
      'earliest convenience',
    ],
    [
      'SECOND_REMINDER',
      'Action required — your Mero Telecom payment is still overdue',
      'Payment required — invoice still overdue',
      'make payment promptly',
    ],
    [
      'FINAL_WARNING',
      'FINAL NOTICE — service suspension scheduled for 8 October 2026',
      'Final notice — service suspension approaching',
      'Pay now to avoid service interruption',
    ],
    [
      'SERVICE_SUSPENDED',
      'Your Mero Telecom service has been suspended',
      'Service suspended',
      'Make payment to begin service restoration',
    ],
  ] as const)(
    'renders the %s amount, title, tone, and subject',
    (event, subject, title, message) => {
      const result = renderOverdueEmail({ ...data, event });
      expect(result.subject).toBe(subject);
      expect(result.html).toContain(title);
      expect(result.html).toContain('$79.90');
      expect(result.text).toContain(message);
      expect(result.html).toContain('Sam &lt;Customer&gt;');
      expect(result.html).toContain(
        event === 'SERVICE_SUSPENDED' ? 'Pay Outstanding Balance' : 'Pay Now',
      );
      if (event !== 'SERVICE_SUSPENDED') expect(result.html).toContain('View Invoice');
    },
  );
  it('escalates from a mild warning to a strong warning to a prominent critical notice', () => {
    const first = renderOverdueEmail(data).html;
    const second = renderOverdueEmail({ ...data, event: 'SECOND_REMINDER' }).html;
    const final = renderOverdueEmail({ ...data, event: 'FINAL_WARNING' }).html;
    expect(first).not.toContain('border-left:4px solid #92400e');
    expect(second).toContain('border-left:4px solid #92400e');
    expect(final).toContain('border-left:6px solid #9f1239');
    expect(final).toContain('FINAL NOTICE');
  });
  it('uses the supplied policy/grace deadline in the subject, message and details', () => {
    const result = renderOverdueEmail({
      ...data,
      event: 'FINAL_WARNING',
      gracePeriodEndsAt: new Date('2026-10-12T00:00:00Z'),
    });
    expect(result.subject).toBe('FINAL NOTICE — service suspension scheduled for 12 October 2026');
    expect(result.text).toContain('scheduled for suspension on 12 October 2026');
    expect(result.html).not.toContain('8 October 2026');
  });
  it('announces an extension with the new date and continued service during grace', () => {
    const result = renderOverdueEmail({
      ...data,
      event: 'GRACE_PERIOD_EXTENDED',
      gracePeriodEndsAt: new Date('2026-10-11T00:00:00Z'),
    });
    expect(result.text).toContain('extended until 11 October 2026');
    expect(result.text).toContain('will remain active until this deadline');
    expect(result.html).not.toContain('8 October 2026');
  });
  it('renders the one-time recovery final notice with its new deadline and critical design', () => {
    const result = renderOverdueEmail({ ...data, event: 'RECOVERY_FINAL_WARNING' });
    expect(result.subject).toBe('Final payment notice');
    expect(result.text).toContain('original payment grace period has ended');
    expect(result.text).toContain('service will remain active until 8 October 2026');
    expect(result.html).toContain('border-left:6px solid #9f1239');
    expect(result.html).toContain('Pay Now');
    expect(result.html).toContain('View Invoice');
  });
  it('does not send a final notice without a calculated suspension date', () => {
    expect(() =>
      renderOverdueEmail({ ...data, event: 'FINAL_WARNING', gracePeriodEndsAt: null }),
    ).toThrow('calculated suspension date');
  });
  it('preserves polite first reminder copy without implying imminent suspension', () => {
    expect(overdueCommunication(data).intro).toBe(
      'Your payment of $79.90 is overdue. Please make payment at your earliest convenience to keep your account up to date.',
    );
    expect(overdueCommunication(data).intro).not.toMatch(/suspend|interruption/);
  });
});
