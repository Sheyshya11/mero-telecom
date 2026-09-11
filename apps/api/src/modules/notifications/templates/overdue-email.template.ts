import { renderCommunicationEmail } from './communication-email-layout';
import type { RenderedEmailTemplate } from './invoice-email.template';

export type OverdueEmailEvent =
  | 'PAYMENT_FAILED'
  | 'OVERDUE_REMINDER'
  | 'SUSPENSION_WARNING'
  | 'SERVICE_SUSPENDED'
  | 'PAYMENT_RECEIVED'
  | 'SERVICE_RESTORATION_REQUESTED';

export interface OverdueEmailData {
  event: OverdueEmailEvent;
  brandLogoUrl: string;
  customerName: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  dueDate: Date;
  gracePeriodEndsAt?: Date | null;
  suspendedAt?: Date | null;
  dashboardUrl: string;
}

export function renderOverdueEmail(data: OverdueEmailData): RenderedEmailTemplate {
  const amount = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: data.currency,
  }).format(data.amountCents / 100);
  const formatDate = (value: Date) =>
    new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Australia/Adelaide',
    }).format(value);
  const content = copy[data.event];
  const details = [
    { label: 'Invoice', value: data.invoiceNumber },
    { label: 'Amount due', value: amount },
    { label: 'Original due date', value: formatDate(data.dueDate) },
  ];
  if (data.gracePeriodEndsAt) {
    details.push({ label: 'Grace period ends', value: formatDate(data.gracePeriodEndsAt) });
  }
  if (data.suspendedAt) {
    details.push({ label: 'Suspended', value: formatDate(data.suspendedAt) });
  }
  const text = [
    `Hi ${data.customerName},`,
    '',
    content.intro,
    `Invoice: ${data.invoiceNumber}`,
    `Amount: ${amount}`,
    `Due date: ${formatDate(data.dueDate)}`,
    data.gracePeriodEndsAt ? `Grace period ends: ${formatDate(data.gracePeriodEndsAt)}` : '',
    '',
    `Manage billing: ${data.dashboardUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject: content.subject,
    text,
    html: renderCommunicationEmail({
      brandLogoUrl: data.brandLogoUrl,
      preheader: content.subject,
      eyebrow: 'Billing · Service status',
      title: content.title,
      intro: content.intro,
      recipientName: data.customerName,
      reference: data.invoiceNumber,
      statusLabel: content.status,
      tone: content.tone,
      details,
      action: { label: content.action, url: data.dashboardUrl },
      note: content.note,
    }),
  };
}

const copy: Record<
  OverdueEmailEvent,
  {
    subject: string;
    title: string;
    status: string;
    tone: 'warning' | 'danger' | 'success' | 'info';
    intro: string;
    action: string;
    note: string;
  }
> = {
  PAYMENT_FAILED: {
    subject: 'Payment unsuccessful — action required',
    title: 'We could not process your payment',
    status: 'Past due',
    tone: 'warning',
    intro:
      'Your internet service remains available during the grace period. Please pay the overdue balance to avoid suspension.',
    action: 'Pay invoice',
    note: 'Do not email card details. Use the secure billing page to retry payment.',
  },
  OVERDUE_REMINDER: {
    subject: 'Reminder: your Mero Telecom payment is overdue',
    title: 'Payment overdue',
    status: 'Past due',
    tone: 'warning',
    intro:
      'Your service remains available during the grace period. Please pay the outstanding balance before the grace period ends.',
    action: 'Pay invoice',
    note: 'If you are having difficulty paying, contact our support team through your account.',
  },
  SUSPENSION_WARNING: {
    subject: 'Service suspension warning',
    title: 'Payment required to avoid suspension',
    status: 'Grace period ending',
    tone: 'danger',
    intro:
      'Your grace period is nearly finished. Your internet service may be suspended if the overdue balance remains unpaid.',
    action: 'Pay now',
    note: 'Payment confirmation must be received before the grace period ends.',
  },
  SERVICE_SUSPENDED: {
    subject: 'Your Mero Telecom service has been suspended',
    title: 'Service suspended',
    status: 'Suspended',
    tone: 'danger',
    intro:
      'Your service has been suspended because the overdue balance was not paid before the grace period ended.',
    action: 'Pay overdue balance',
    note: 'A restoration request will begin after the complete outstanding balance is confirmed paid.',
  },
  PAYMENT_RECEIVED: {
    subject: 'Payment received',
    title: 'Thank you — payment confirmed',
    status: 'Paid',
    tone: 'success',
    intro: 'We have confirmed your payment and updated your billing account.',
    action: 'View billing',
    note: 'Keep this email with your payment records.',
  },
  SERVICE_RESTORATION_REQUESTED: {
    subject: 'Service restoration has started',
    title: 'Restoration request submitted',
    status: 'Restoration in progress',
    tone: 'success',
    intro: 'Your payment has been confirmed and we have started restoring your internet service.',
    action: 'View service status',
    note: 'Provisioning can take additional processing time. We will retain the request if the provider needs a retry.',
  },
};
