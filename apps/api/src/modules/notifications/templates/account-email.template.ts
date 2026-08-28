import type { AccountInvitationReason } from '@prisma/client';

import type { RenderedEmailTemplate } from './invoice-email.template';

interface AccountInvitationTemplateData {
  customerName: string;
  activationUrl: string;
  expiresAt: Date;
  reason: AccountInvitationReason;
}

interface SubscriptionConfirmationTemplateData {
  customerName: string;
  planName: string;
  invoiceNumber: string;
  totalCents: number;
  currency: string;
  activationPending: boolean;
}

interface StaffInvitationTemplateData {
  displayName: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF';
  activationUrl: string;
  expiresAt: Date;
}

export function renderStaffInvitationEmail(
  data: StaffInvitationTemplateData,
): RenderedEmailTemplate {
  const expiry = new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Australia/Adelaide',
  }).format(data.expiresAt);
  const roleName =
    data.role === 'SUPER_ADMIN'
      ? 'super administrator'
      : data.role === 'ADMIN'
        ? 'administrator'
        : 'staff member';

  return {
    subject: `Your Mero Telecom ${roleName} invitation`,
    text: [
      `Hello ${data.displayName},`,
      '',
      `You have been invited to join Mero Telecom as an ${roleName}.`,
      'Use the secure, single-use link below to verify your email and create your password.',
      data.activationUrl,
      '',
      `This link expires at ${expiry}.`,
      'If you did not expect this invitation, do not use the link and contact Mero Telecom.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
    <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="background:#075985;padding:24px;color:#fff"><div style="font-size:22px;font-weight:700">MERO TELECOM</div></div>
      <div style="padding:28px">
        <p>Hello ${escapeHtml(data.displayName)},</p>
        <h1 style="font-size:22px">Join Mero Telecom</h1>
        <p>You have been invited as an <strong>${escapeHtml(roleName)}</strong>. Verify your email and create your password using this secure, single-use link.</p>
        <p style="margin:28px 0"><a href="${escapeHtml(data.activationUrl)}" style="background:#0369a1;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Accept invitation</a></p>
        <p style="color:#475569">This link expires at ${escapeHtml(expiry)}. Never share this invitation or your password.</p>
      </div>
    </div>
  </body>
</html>`,
  };
}

export function renderAccountInvitationEmail(
  data: AccountInvitationTemplateData,
): RenderedEmailTemplate {
  const expiry = new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Australia/Adelaide',
  }).format(data.expiresAt);
  const heading =
    data.reason === 'ADMIN_CREATED'
      ? 'Your Mero Telecom account is ready to activate'
      : data.reason === 'RESEND'
        ? 'Your new Mero Telecom activation link'
        : 'Activate your Mero Telecom account';

  return {
    subject: heading,
    text: [
      `Hello ${data.customerName},`,
      '',
      heading,
      'Use the secure link below to verify your email and create your password.',
      data.activationUrl,
      '',
      `This single-use link expires at ${expiry}.`,
      'If you did not expect this message, contact Mero Telecom support.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
    <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="background:#075985;padding:24px;color:#fff">
        <div style="font-size:22px;font-weight:700">MERO TELECOM</div>
        <div style="margin-top:4px;font-size:13px">Secure account activation</div>
      </div>
      <div style="padding:28px">
        <p>Hello ${escapeHtml(data.customerName)},</p>
        <h1 style="font-size:22px">${escapeHtml(heading)}</h1>
        <p>Verify your email and create your own password using this secure, single-use link.</p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(data.activationUrl)}" style="background:#0369a1;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Activate account</a>
        </p>
        <p style="color:#475569">This link expires at ${escapeHtml(expiry)}. A Mero Telecom employee will never ask for your password or activation link.</p>
      </div>
    </div>
  </body>
</html>`,
  };
}

export function renderSubscriptionConfirmationEmail(
  data: SubscriptionConfirmationTemplateData,
): RenderedEmailTemplate {
  const total = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: data.currency,
  }).format(data.totalCents / 100);
  const accountMessage = data.activationPending
    ? 'Your payment and subscription are recorded. Activate your account using the separate secure email before signing in.'
    : 'Your subscription is now available in your customer dashboard.';

  return {
    subject: `Mero Telecom ${data.planName} subscription confirmed`,
    text: [
      `Hello ${data.customerName},`,
      '',
      `Plan: ${data.planName}`,
      `Invoice: ${data.invoiceNumber}`,
      `Paid: ${total}`,
      '',
      accountMessage,
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
    <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="background:#075985;padding:24px;color:#fff"><div style="font-size:22px;font-weight:700">MERO TELECOM</div></div>
      <div style="padding:28px">
        <p>Hello ${escapeHtml(data.customerName)},</p>
        <h1 style="font-size:22px">Subscription confirmed</h1>
        <p><strong>${escapeHtml(data.planName)}</strong> has been recorded for your service.</p>
        <table role="presentation" style="width:100%;margin:24px 0;border-collapse:collapse">
          <tr><td style="padding:10px;background:#e0f2fe">Paid</td><td style="padding:10px;background:#e0f2fe;text-align:right;font-weight:700">${escapeHtml(total)}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0">Invoice</td><td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right">${escapeHtml(data.invoiceNumber)}</td></tr>
        </table>
        <p style="color:#475569">${escapeHtml(accountMessage)}</p>
      </div>
    </div>
  </body>
</html>`,
  };
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
