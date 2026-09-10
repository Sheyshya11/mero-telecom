import type { RenderedEmailTemplate } from './invoice-email.template';
import { renderEmailLogo } from './email-brand';

export type PlanChangeEmailEvent = 'SCHEDULED' | 'APPLIED' | 'CANCELLED' | 'FAILED';

interface PlanChangeEmailData {
  brandLogoUrl: string;
  event: PlanChangeEmailEvent;
  customerName: string;
  oldPlanName: string;
  newPlanName: string;
  amountCents: number;
  currency: string;
  effectiveAt: Date;
  nextBillingAt: Date;
  dashboardUrl: string;
}

export function renderPlanChangeEmail(data: PlanChangeEmailData): RenderedEmailTemplate {
  const amount = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: data.currency,
  }).format(data.amountCents / 100);
  const effectiveDate = formatDate(data.effectiveAt);
  const nextBillingDate = formatDate(data.nextBillingAt);
  const content = eventContent(data.event, effectiveDate);
  const amountLine = data.amountCents > 0 ? `Amount paid: ${amount}` : 'Amount due today: $0.00';

  return {
    subject: `Mero Telecom plan change ${content.subjectSuffix}`,
    text: [
      `Hello ${data.customerName},`,
      '',
      content.message,
      `Previous plan: ${data.oldPlanName}`,
      `New plan: ${data.newPlanName}`,
      amountLine,
      `Effective date: ${effectiveDate}`,
      `Next billing date: ${nextBillingDate}`,
      '',
      `View your subscription: ${data.dashboardUrl}`,
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
    <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="padding:20px 28px;border-bottom:1px solid #e2e8f0">${renderEmailLogo(data.brandLogoUrl)}</div>
      <div style="padding:28px">
        <p>Hello ${escapeHtml(data.customerName)},</p>
        <h1 style="font-size:22px">Plan change ${escapeHtml(content.heading)}</h1>
        <p>${escapeHtml(content.message)}</p>
        <table role="presentation" style="width:100%;margin:24px 0;border-collapse:collapse">
          <tr><td style="padding:10px;background:#e0f2fe">Previous plan</td><td style="padding:10px;background:#e0f2fe;text-align:right">${escapeHtml(data.oldPlanName)}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0">New plan</td><td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700">${escapeHtml(data.newPlanName)}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0">${data.amountCents > 0 ? 'Paid' : 'Due today'}</td><td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right">${escapeHtml(data.amountCents > 0 ? amount : '$0.00')}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0">Effective</td><td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right">${escapeHtml(effectiveDate)}</td></tr>
          <tr><td style="padding:10px">Next billing</td><td style="padding:10px;text-align:right">${escapeHtml(nextBillingDate)}</td></tr>
        </table>
        <p><a href="${escapeHtml(data.dashboardUrl)}" style="background:#0369a1;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">View subscription</a></p>
      </div>
    </div>
  </body>
</html>`,
  };
}

function eventContent(event: PlanChangeEmailEvent, effectiveDate: string) {
  switch (event) {
    case 'SCHEDULED':
      return {
        heading: 'scheduled',
        subjectSuffix: 'scheduled',
        message: `Your current plan remains active until ${effectiveDate}. The new plan begins on that date, with no immediate refund.`,
      };
    case 'APPLIED':
      return {
        heading: 'confirmed',
        subjectSuffix: 'confirmed',
        message: 'Your plan change is now effective and is available in your customer dashboard.',
      };
    case 'CANCELLED':
      return {
        heading: 'cancelled',
        subjectSuffix: 'cancelled',
        message: 'Your scheduled downgrade was cancelled. Your existing plan remains active.',
      };
    case 'FAILED':
      return {
        heading: 'needs attention',
        subjectSuffix: 'needs attention',
        message:
          'The requested plan change could not be applied. Your existing subscription was not changed. Please contact support.',
      };
  }
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Australia/Adelaide',
  }).format(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character] ?? character;
  });
}
