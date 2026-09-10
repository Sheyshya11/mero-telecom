import { renderEmailLogo } from './email-brand';

export interface CommunicationEmailDetail {
  label: string;
  value: string;
}

export interface CommunicationEmailAction {
  label: string;
  url: string;
}

interface CommunicationEmailLayoutInput {
  brandLogoUrl: string;
  preheader: string;
  eyebrow: string;
  title: string;
  intro: string;
  recipientName?: string;
  reference?: string;
  statusLabel?: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  details?: CommunicationEmailDetail[];
  message?: string;
  action?: CommunicationEmailAction;
  internal?: boolean;
  note?: string;
}

const tones = {
  info: { background: '#e0f2fe', foreground: '#075985', border: '#bae6fd' },
  success: { background: '#dcfce7', foreground: '#166534', border: '#bbf7d0' },
  warning: { background: '#fef3c7', foreground: '#92400e', border: '#fde68a' },
  danger: { background: '#ffe4e6', foreground: '#9f1239', border: '#fecdd3' },
} as const;

export function renderCommunicationEmail(input: CommunicationEmailLayoutInput): string {
  const tone = tones[input.tone ?? 'info'];
  const greeting = input.recipientName
    ? `<p style="margin:0 0 18px;font-size:15px;line-height:24px;color:#334155">Hi ${escapeHtml(input.recipientName)},</p>`
    : '';
  const classification = input.internal
    ? `<tr><td style="padding:0 32px 20px"><div style="border:1px solid #fed7aa;background:#fff7ed;border-radius:10px;padding:11px 14px;font-size:12px;line-height:18px;font-weight:700;letter-spacing:.06em;color:#9a3412;text-align:center">INTERNAL · CONFIDENTIAL · NOT CUSTOMER VISIBLE</div></td></tr>`
    : '';
  const status = input.statusLabel
    ? `<span style="display:inline-block;border:1px solid ${tone.border};background:${tone.background};color:${tone.foreground};border-radius:999px;padding:6px 11px;font-size:11px;line-height:14px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">${escapeHtml(input.statusLabel)}</span>`
    : '';
  const reference = input.reference
    ? `<span style="display:inline-block;margin-left:${status ? '8px' : '0'};border:1px solid #dbe3ee;background:#f8fafc;color:#334155;border-radius:999px;padding:6px 11px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;line-height:14px;font-weight:700">${escapeHtml(input.reference)}</span>`
    : '';
  const details = input.details?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;overflow:hidden">${input.details
        .map(
          (detail, index) =>
            `<tr><td style="width:34%;padding:11px 14px;${index ? 'border-top:1px solid #e2e8f0;' : ''}background:#f8fafc;font-size:12px;line-height:18px;font-weight:700;color:#64748b;vertical-align:top">${escapeHtml(detail.label)}</td><td style="padding:11px 14px;${index ? 'border-top:1px solid #e2e8f0;' : ''}font-size:13px;line-height:20px;color:#0f172a;vertical-align:top;word-break:break-word">${escapeHtml(detail.value)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const message = input.message
    ? `<div style="margin:22px 0;border-left:4px solid #0284c7;background:#f0f9ff;border-radius:0 10px 10px 0;padding:16px 18px"><p style="margin:0 0 7px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0369a1">Message from Mero Telecom</p><p style="margin:0;white-space:pre-wrap;font-size:14px;line-height:23px;color:#1e293b">${escapeHtml(input.message)}</p></div>`
    : '';
  const action = input.action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 8px"><tr><td bgcolor="#0369a1" style="border-radius:9px"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;padding:12px 20px;font-size:14px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none">${escapeHtml(input.action.label)}</a></td></tr></table><p style="margin:12px 0 0;font-size:11px;line-height:17px;color:#64748b;word-break:break-all">If the button does not work, copy this address:<br><a href="${escapeHtml(input.action.url)}" style="color:#0369a1">${escapeHtml(input.action.url)}</a></p>`
    : '';
  const note = input.note
    ? `<p style="margin:22px 0 0;padding-top:18px;border-top:1px solid #e2e8f0;font-size:12px;line-height:19px;color:#64748b">${escapeHtml(input.note)}</p>`
    : '';

  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(input.title)}</title>
  <style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.email-pad{padding-left:20px!important;padding-right:20px!important}.brand-pad{padding:22px 20px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,'Helvetica Neue',sans-serif;color:#0f172a">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(input.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9">
    <tr><td align="center" style="padding:28px 12px">
      <table role="presentation" width="600" class="email-shell" cellspacing="0" cellpadding="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #dbe3ee;border-radius:16px;border-collapse:separate;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.06)">
        <tr><td class="brand-pad" style="padding:20px 32px;background:#ffffff;border-bottom:1px solid #e2e8f0">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
            <td>${renderEmailLogo(input.brandLogoUrl)}</td>
            <td align="right" style="padding-left:16px;font-size:10px;line-height:15px;font-weight:700;letter-spacing:.12em;color:#075985;text-transform:uppercase">Customer Care</td>
          </tr></table>
        </td></tr>
        ${classification}
        <tr><td class="email-pad" style="padding:32px">
          <p style="margin:0 0 8px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0284c7">${escapeHtml(input.eyebrow)}</p>
          <h1 style="margin:0 0 14px;font-size:25px;line-height:33px;color:#0f172a;font-weight:800">${escapeHtml(input.title)}</h1>
          <div style="margin:0 0 22px">${status}${reference}</div>
          ${greeting}
          <p style="margin:0;font-size:15px;line-height:24px;color:#334155">${escapeHtml(input.intro)}</p>
          ${details}${message}${action}${note}
        </td></tr>
        <tr><td class="email-pad" style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:11px;line-height:18px;color:#64748b">Mero Telecom · South Australia</p>
          <p style="margin:4px 0 0;font-size:11px;line-height:18px;color:#94a3b8">This is an automated service notification. Never send passwords, verification codes or complete card details by email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function humanizeEmailValue(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
