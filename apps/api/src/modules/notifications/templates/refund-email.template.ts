import type { RefundReason } from '@prisma/client';

export interface RefundEmailData {
  refundId: string;
  customerName: string;
  invoiceNumber: string;
  originalAmountCents: number;
  refundAmountCents: number;
  currency: string;
  reason: RefundReason;
  processedAt: Date;
  customerMessage?: string | null;
}

type RefundEmailEvent =
  | 'REQUESTED'
  | 'MORE_INFORMATION_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUCCEEDED'
  | 'FAILED';

export function renderRefundEmail(input: RefundEmailData, event: RefundEmailEvent) {
  const amount = money(input.refundAmountCents, input.currency);
  const original = money(input.originalAmountCents, input.currency);
  const copy = content(event, amount);
  const text = [
    `Hi ${input.customerName},`,
    '',
    copy.message,
    '',
    `Refund reference: ${input.refundId}`,
    `Invoice: ${input.invoiceNumber}`,
    `Original payment: ${original}`,
    `Refund amount: ${amount}`,
    `Reason: ${input.reason.replaceAll('_', ' ').toLowerCase()}`,
    ...(event === 'SUCCEEDED'
      ? [
          `Refund date: ${input.processedAt.toLocaleDateString('en-AU')}`,
          'Funds are being returned to the original payment method.',
        ]
      : []),
    ...(event === 'MORE_INFORMATION_REQUIRED' && input.customerMessage
      ? [`Message from our team: ${input.customerMessage}`]
      : []),
    '',
    'Contact Mero Telecom support if you need help.',
  ].join('\n');
  return {
    subject: copy.subject,
    text,
    html: `<p>Hi ${escapeHtml(input.customerName)},</p><p>${copy.message}</p>${event === 'MORE_INFORMATION_REQUIRED' && input.customerMessage ? `<p><strong>Message from our team:</strong> ${escapeHtml(input.customerMessage)}</p>` : ''}<dl><dt>Refund reference</dt><dd>${input.refundId}</dd><dt>Invoice</dt><dd>${escapeHtml(input.invoiceNumber)}</dd><dt>Original payment</dt><dd>${original}</dd><dt>Refund amount</dt><dd>${amount}</dd></dl>${event === 'SUCCEEDED' ? '<p>Funds are being returned to the original payment method.</p>' : ''}<p>Contact Mero Telecom support if you need help.</p>`,
  };
}

function content(event: RefundEmailEvent, amount: string) {
  const values = {
    REQUESTED: {
      subject: 'We received your refund request',
      message:
        'We received your refund request. Our team will review it before any money is moved.',
    },
    MORE_INFORMATION_REQUIRED: {
      subject: 'More information is needed for your refund',
      message:
        'Our billing team needs more information before they can complete the refund review.',
    },
    APPROVED: {
      subject: 'Your refund request was approved',
      message: `Your refund request for ${amount} was approved and is ready for processing.`,
    },
    REJECTED: {
      subject: 'Update on your refund request',
      message:
        'After review, your refund request was not approved. Contact support if you need more information.',
    },
    SUCCEEDED: {
      subject: 'Your refund was completed',
      message: `Your refund of ${amount} was completed successfully.`,
    },
    FAILED: {
      subject: 'Your refund needs further review',
      message:
        'We could not complete your refund yet. Our billing team has been notified and will review it.',
    },
  } satisfies Record<RefundEmailEvent, { subject: string; message: string }>;
  return values[event];
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
