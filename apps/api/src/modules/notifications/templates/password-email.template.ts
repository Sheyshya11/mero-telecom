import type { RenderedEmailTemplate } from './invoice-email.template';
import { renderEmailLogo } from './email-brand';

export function renderPasswordResetEmail(input: {
  brandLogoUrl: string;
  displayName: string;
  resetUrl: string;
  expiresAt: Date;
}): RenderedEmailTemplate {
  const expiry = new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Australia/Adelaide',
  }).format(input.expiresAt);

  return {
    subject: 'Reset your Mero Telecom password',
    text: [
      `Hello ${input.displayName},`,
      '',
      'We received a request to reset your Mero Telecom password.',
      'Use this secure, single-use link:',
      input.resetUrl,
      '',
      `This link expires at ${expiry}.`,
      'If you did not request this, you can safely ignore this email. Your password has not changed.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
    <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="padding:20px 28px;border-bottom:1px solid #e2e8f0">${renderEmailLogo(input.brandLogoUrl)}</div>
      <div style="padding:28px">
        <p>Hello ${escapeHtml(input.displayName)},</p>
        <h1 style="font-size:22px">Reset your password</h1>
        <p>We received a request to reset your Mero Telecom password. Use the secure, single-use link below.</p>
        <p style="margin:28px 0"><a href="${escapeHtml(input.resetUrl)}" style="background:#0369a1;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Reset password</a></p>
        <p style="color:#475569">This link expires at ${escapeHtml(expiry)}. If you did not request it, you can safely ignore this email. Your password has not changed.</p>
      </div>
    </div>
  </body>
</html>`,
  };
}

export function renderPasswordChangedEmail(input: {
  brandLogoUrl: string;
  displayName: string;
}): RenderedEmailTemplate {
  return {
    subject: 'Your Mero Telecom password was changed',
    text: [
      `Hello ${input.displayName},`,
      '',
      'Your Mero Telecom password was changed successfully.',
      'For your security, all existing sessions have been signed out.',
      'If you did not make this change, contact Mero Telecom support immediately.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
    <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="padding:20px 28px;border-bottom:1px solid #e2e8f0">${renderEmailLogo(input.brandLogoUrl)}</div>
      <div style="padding:28px">
        <p>Hello ${escapeHtml(input.displayName)},</p>
        <h1 style="font-size:22px">Password changed</h1>
        <p>Your Mero Telecom password was changed successfully.</p>
        <p>For your security, all existing sessions have been signed out.</p>
        <p style="color:#9f1239"><strong>If you did not make this change, contact Mero Telecom support immediately.</strong></p>
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
