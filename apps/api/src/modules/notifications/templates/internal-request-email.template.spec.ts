import {
  renderAssignedInternalRequestReplyEmail,
  renderInternalRequestAdminEscalationEmail,
  renderInternalRequestStaffEmail,
  renderNewInternalRequestEmail,
  renderInternalRequestSuperAdminEmail,
} from './internal-request-email.template';

const brandLogoUrl = 'https://example.test/brand/mero-telecom-logo.jpg';

describe('internal request email templates', () => {
  it('escapes internal request data and flags high priority', () => {
    const email = renderNewInternalRequestEmail({
      brandLogoUrl,
      requestNumber: 'IR-2026-00001',
      requesterName: '<Staff & Co>',
      type: 'REFUND_REVIEW',
      priority: 'HIGH',
      requestUrl: 'https://example.test/internal?x=1&y=2',
    });
    expect(email.subject).toContain('High priority');
    expect(email.html).toContain('&lt;Staff &amp; Co&gt;');
    expect(email.html).not.toContain('<Staff & Co>');
    expect(email.html).toContain('INTERNAL · CONFIDENTIAL · NOT CUSTOMER VISIBLE');
    expect(email.html).toContain('Review internal request');
  });

  it('makes approval separation explicit', () => {
    const email = renderInternalRequestStaffEmail({
      brandLogoUrl,
      event: 'APPROVED',
      requestNumber: 'IR-2026-00001',
      staffName: 'Staff',
      requestUrl: 'https://example.test/internal',
    });
    expect(email.text).toContain('must still be completed separately');
  });

  it('explains that a Staff response resumes review', () => {
    const email = renderAssignedInternalRequestReplyEmail({
      brandLogoUrl,
      requestNumber: 'IR-2026-00001',
      requestUrl: 'https://example.test/internal',
      resumedReview: true,
    });
    expect(email.text).toContain('back in review');
  });

  it('keeps escalation decisions operationally separate and internal', () => {
    const superAdmin = renderInternalRequestSuperAdminEmail({
      brandLogoUrl,
      event: 'ESCALATED',
      requestNumber: 'IR-2026-00042',
      priority: 'HIGH',
      requestUrl: 'https://example.test/internal',
    });
    const admin = renderInternalRequestAdminEscalationEmail({
      brandLogoUrl,
      event: 'APPROVED',
      requestNumber: 'IR-2026-00042',
      requestUrl: 'https://example.test/internal',
    });
    expect(superAdmin.subject).toContain('High priority');
    expect(admin.text).toContain('No business action was executed automatically');
  });
});
