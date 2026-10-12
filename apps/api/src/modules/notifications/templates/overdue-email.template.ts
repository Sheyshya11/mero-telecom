import { renderCommunicationEmail } from './communication-email-layout';
import type { RenderedEmailTemplate } from './invoice-email.template';

export type OverdueEmailEvent =
  | 'FIRST_REMINDER'
  | 'SECOND_REMINDER'
  | 'FINAL_WARNING'
  | 'RECOVERY_FINAL_WARNING'
  | 'MANUAL_REMINDER'
  | 'GRACE_PERIOD_EXTENDED'
  | 'SERVICE_RESTORED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_AUTHENTICATION_REQUIRED'
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
  const content = overdueCommunication(data);
  const details = [
    { label: 'Invoice', value: data.invoiceNumber },
    { label: 'Amount due', value: amount },
    { label: 'Original due date', value: formatDate(data.dueDate) },
  ];
  if (data.gracePeriodEndsAt) {
    details.push({
      label: 'Suspension date / grace period ends',
      value:
        data.event === 'RECOVERY_FINAL_WARNING'
          ? new Intl.DateTimeFormat('en-AU', {
              dateStyle: 'long',
              timeStyle: 'short',
              timeZone: 'Australia/Adelaide',
            }).format(data.gracePeriodEndsAt)
          : formatDate(data.gracePeriodEndsAt),
    });
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
    `${content.action}: ${data.dashboardUrl}`,
    content.secondaryAction ? `View Invoice: ${data.dashboardUrl}` : '',
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
      emphasis: content.emphasis,
      details,
      action: { label: content.action, url: data.dashboardUrl },
      secondaryAction: content.secondaryAction
        ? { label: 'View Invoice', url: data.dashboardUrl }
        : undefined,
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
    emphasis?: 'strong' | 'critical';
    secondaryAction?: boolean;
  }
> = {
  FIRST_REMINDER: {
    subject: 'Your Mero Telecom invoice is overdue',
    title: 'Payment overdue',
    status: 'Overdue',
    tone: 'warning',
    intro: 'Please pay your outstanding invoice to keep your account up to date.',
    action: 'Pay now',
    note: 'Contact support if you need more time to pay.',
  },
  SECOND_REMINDER: {
    subject: 'Payment reminder',
    title: 'Payment reminder',
    status: 'Overdue',
    tone: 'warning',
    intro: 'Your invoice remains unpaid. Please make payment to avoid service interruption.',
    action: 'Pay now',
    note: 'Your service remains available during the grace period.',
  },
  FINAL_WARNING: {
    subject: 'Final payment warning',
    title: 'Final payment warning',
    status: 'Suspension scheduled',
    tone: 'danger',
    intro:
      'Please pay by the suspension date shown below to avoid suspension of your internet service.',
    action: 'Pay now',
    note: 'A processing payment will be checked before suspension.',
  },
  RECOVERY_FINAL_WARNING: {
    subject: 'Final payment notice',
    title: 'Final payment notice',
    status: 'FINAL NOTICE',
    tone: 'danger',
    intro: 'Your original payment grace period has ended.',
    action: 'Pay Now',
    note: 'A processing payment will be checked before suspension.',
    emphasis: 'critical',
    secondaryAction: true,
  },
  MANUAL_REMINDER: {
    subject: 'Payment reminder from Mero Telecom',
    title: 'Payment reminder',
    status: 'Overdue',
    tone: 'warning',
    intro: 'Please review and pay your outstanding invoice.',
    action: 'Pay now',
    note: 'Contact support if you need assistance.',
  },
  GRACE_PERIOD_EXTENDED: {
    subject: 'Payment grace period extended',
    title: 'Payment grace period extended',
    status: 'Grace period extended',
    tone: 'info',
    intro: 'Your payment grace period has been extended to the date below.',
    action: 'View invoice',
    note: 'Your service remains available during this grace period.',
  },
  SERVICE_RESTORED: {
    subject: 'Your Mero Telecom service has been restored',
    title: 'Service restored',
    status: 'Active',
    tone: 'success',
    intro: 'Your payment has been received and your internet service has been restored.',
    action: 'View account',
    note: 'Thank you for bringing your account up to date.',
  },
  PAYMENT_AUTHENTICATION_REQUIRED: {
    subject: 'Authenticate your Mero Telecom payment',
    title: 'Payment authentication required',
    status: 'Action required',
    tone: 'warning',
    intro:
      'Your bank requires an additional security check before this automatic payment can complete. Your card has not been charged twice.',
    action: 'Authenticate payment',
    note: 'Use the secure Stripe billing page. Never send card or verification details by email.',
  },
  PAYMENT_FAILED: {
    subject: 'Payment unsuccessful — action required',
    title: 'We could not process your payment',
    status: 'Payment unsuccessful',
    tone: 'warning',
    intro: "We couldn't process your automatic payment. Please review your payment method.",
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

export function overdueCommunication(
  data: Pick<
    OverdueEmailData,
    'event' | 'amountCents' | 'currency' | 'invoiceNumber' | 'gracePeriodEndsAt'
  >,
): (typeof copy)[OverdueEmailEvent] {
  if (['FINAL_WARNING', 'RECOVERY_FINAL_WARNING'].includes(data.event) && !data.gracePeriodEndsAt) {
    throw new Error('Final payment warnings require a calculated suspension date.');
  }
  const content = { ...copy[data.event] };
  const amount = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: data.currency,
  }).format(data.amountCents / 100);
  const date = data.gracePeriodEndsAt
    ? new Intl.DateTimeFormat('en-AU', {
        dateStyle: 'long',
        timeStyle: data.event === 'RECOVERY_FINAL_WARNING' ? 'short' : undefined,
        timeZone: 'Australia/Adelaide',
      }).format(data.gracePeriodEndsAt)
    : 'the updated payment deadline';
  switch (data.event) {
    case 'FIRST_REMINDER':
      return {
        ...content,
        subject: `Payment reminder — Invoice ${data.invoiceNumber} is overdue`,
        intro: `Your payment of ${amount} is overdue. Please make payment at your earliest convenience to keep your account up to date.`,
        status: 'First reminder',
        action: 'Pay Now',
        secondaryAction: true,
      };
    case 'SECOND_REMINDER':
      return {
        ...content,
        subject: 'Action required — your Mero Telecom payment is still overdue',
        title: 'Payment required — invoice still overdue',
        intro: `Your overdue balance of ${amount} is still unpaid. Please make payment promptly to avoid interruption to your Mero Telecom service.`,
        status: 'Urgent payment reminder',
        emphasis: 'strong',
        action: 'Pay Now',
        secondaryAction: true,
      };
    case 'FINAL_WARNING':
      return {
        ...content,
        subject: `FINAL NOTICE — service suspension scheduled for ${date}`,
        title: 'Final notice — service suspension approaching',
        intro: `Your overdue balance of ${amount} remains unpaid. Your internet service is scheduled for suspension on ${date} unless payment is received. Pay now to avoid service interruption.`,
        status: 'FINAL NOTICE',
        emphasis: 'critical',
        action: 'Pay Now',
        secondaryAction: true,
      };
    case 'RECOVERY_FINAL_WARNING':
      return {
        ...content,
        intro: `Your payment remains overdue and your original payment grace period has ended. To give you a final opportunity to make payment, your service will remain active until ${date}. Please make payment before this date to avoid service suspension.`,
      };
    case 'SERVICE_SUSPENDED':
      return {
        ...content,
        intro: `Your Mero Telecom service has been suspended because your overdue balance of ${amount} remains unpaid. Make payment to begin service restoration.`,
        status: 'SERVICE SUSPENDED',
        emphasis: 'critical',
        action: 'Pay Outstanding Balance',
      };
    case 'GRACE_PERIOD_EXTENDED':
      return {
        ...content,
        subject: 'Payment deadline extended',
        title: 'Payment deadline extended',
        action: 'Pay Now',
        secondaryAction: true,
        intro: `Your payment deadline has been extended until ${date}. Your service will remain active until this deadline. Please make payment before this date to avoid service suspension.`,
      };
    default:
      return content;
  }
}
