import {
  renderNewProspectEnquiryEmail,
  renderNewSupportCaseEmail,
  renderProspectEnquiryReceiptEmail,
  renderProspectSupportEmail,
  renderSupportCustomerEmail,
} from './support-email.template';

const brandLogoUrl = 'https://example.test/brand/mero-telecom-logo.jpg';

describe('support email templates', () => {
  it('renders a branded responsive customer email without an internal classification', () => {
    const email = renderSupportCustomerEmail({
      brandLogoUrl,
      event: 'WAITING_FOR_CUSTOMER',
      caseNumber: 'SUP-2026-00042',
      customerName: 'Jamie Customer',
      supportUrl: 'https://example.test/customer/support/SUP-2026-00042',
    });

    expect(email.html).toContain('<!doctype html>');
    expect(email.html).toContain('name="viewport"');
    expect(email.html).toContain(`<img src="${brandLogoUrl}"`);
    expect(email.html).toContain('Action required');
    expect(email.html).toContain('Reply securely');
    expect(email.html).not.toContain('NOT CUSTOMER VISIBLE');
  });

  it('marks staff support alerts as internal and safely escapes customer context', () => {
    const email = renderNewSupportCaseEmail({
      brandLogoUrl,
      caseNumber: 'SUP-2026-00043',
      customerName: '<Customer & Co>',
      customerEmail: 'customer@example.test',
      subject: '<script>alert(1)</script>',
      supportUrl: 'https://example.test/control-centre/support?x=1&y=2',
    });

    expect(email.html).toContain('INTERNAL · CONFIDENTIAL · NOT CUSTOMER VISIBLE');
    expect(email.html).toContain('&lt;Customer &amp; Co&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('x=1&amp;y=2');
  });

  it('keeps prospect receipts external-safe and includes the enquiry reference', () => {
    const email = renderProspectEnquiryReceiptEmail({
      brandLogoUrl,
      caseNumber: 'MT-E-2026-00044',
      prospectName: 'Jamie Prospect',
    });

    expect(email.subject).toContain('MT-E-2026-00044');
    expect(email.html).toContain('Thanks for getting in touch');
    expect(email.html).toContain('MT-E-2026-00044');
    expect(email.html).not.toContain('NOT CUSTOMER VISIBLE');
  });

  it('renders the actual prospect reply safely without exposing internal controls', () => {
    const email = renderProspectSupportEmail({
      brandLogoUrl,
      event: 'STAFF_REPLIED',
      caseNumber: 'MT-E-2026-00045',
      prospectName: 'Jamie',
      messageBody: 'NBN is available.\n<script>unsafe()</script>',
    });

    expect(email.text).toContain('NBN is available.');
    expect(email.html).toContain('Message from Mero Telecom');
    expect(email.html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(email.html).not.toContain('<script>unsafe()');
  });

  it('formats prospect details for the private operations alert', () => {
    const email = renderNewProspectEnquiryEmail({
      brandLogoUrl,
      caseNumber: 'MT-E-2026-00046',
      prospectName: 'Jamie',
      prospectEmail: 'jamie@example.test',
      category: 'NBN_AVAILABILITY',
      subject: 'Address check',
      supportUrl: 'https://example.test/control-centre/support/MT-E-2026-00046',
    });

    expect(email.html).toContain('Nbn Availability');
    expect(email.html).toContain('INTERNAL · CONFIDENTIAL');
    expect(email.html).toContain('Open enquiry');
  });
});
