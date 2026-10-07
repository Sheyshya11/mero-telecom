import type { RenderedEmailTemplate } from './invoice-email.template';
import { renderCommunicationEmail } from './communication-email-layout';

export type CancellationEmailEvent =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'SCHEDULED'
  | 'REVOKED'
  | 'COMPLETED';

interface CancellationEmailData {
  brandLogoUrl: string;
  event: CancellationEmailEvent;
  requestNumber: string;
  customerName: string;
  planName: string;
  effectiveAt: Date;
  dashboardUrl: string;
  providerOperation: 'DISCONNECT_SERVICE' | 'WITHDRAW_ACTIVATION';
  providerSimulated: boolean;
  cancellationType: 'END_OF_PERIOD' | 'IMMEDIATE';
  refundAmountCents: number;
  refundStatus: string | null;
}

export function renderCancellationEmail(data: CancellationEmailData): RenderedEmailTemplate {
  const date = formatDate(data.effectiveAt);
  const activationWithdrawal = data.providerOperation === 'WITHDRAW_ACTIVATION';
  const content = eventContent(data.event, date, data.providerSimulated, activationWithdrawal);
  const reviewOnly = data.event === 'REQUESTED' || data.event === 'REJECTED';
  const refundSummary = reviewOnly
    ? 'Refund assessment follows employee approval; no refund has been issued.'
    : data.cancellationType === 'IMMEDIATE' && data.refundAmountCents > 0
      ? `Automatic refund: ${formatMoney(data.refundAmountCents)} · ${humanize(data.refundStatus ?? 'APPROVED')}`
      : data.cancellationType === 'IMMEDIATE'
        ? 'Automatic refund: No eligible current-period card payment'
        : 'Automatic refund: Not applicable; service continues to the paid period end';
  const note = reviewOnly
    ? content.note
    : data.cancellationType === 'IMMEDIATE' && data.refundAmountCents > 0
      ? data.event === 'COMPLETED'
        ? `Your ${formatMoney(data.refundAmountCents)} refund is ${humanize(data.refundStatus ?? 'PROCESSING').toLowerCase()} and will return to the original payment method. ${content.note}`
        : `A ${formatMoney(data.refundAmountCents)} prorated refund is reserved and will be sent to the original payment method after service termination succeeds.`
      : content.note;
  return {
    subject: `Mero Telecom cancellation ${content.subjectSuffix} · ${data.requestNumber}`,
    text: [
      `Hi ${data.customerName},`,
      '',
      content.intro,
      `Reference: ${data.requestNumber}`,
      `Plan: ${data.planName}`,
      `${reviewOnly ? 'Proposed service date' : activationWithdrawal ? 'Requested withdrawal' : 'Service end'}: ${date}`,
      refundSummary,
      '',
      note,
      '',
      `View your service: ${data.dashboardUrl}`,
    ].join('\n'),
    html: renderCommunicationEmail({
      brandLogoUrl: data.brandLogoUrl,
      preheader: content.intro,
      eyebrow: activationWithdrawal ? 'Service order withdrawal' : 'Service cancellation',
      title: content.title,
      intro: content.intro,
      recipientName: data.customerName,
      reference: data.requestNumber,
      statusLabel: content.status,
      tone: content.tone,
      details: [
        { label: 'Internet plan', value: data.planName },
        {
          label: reviewOnly
            ? 'Proposed service date'
            : activationWithdrawal
              ? 'Requested withdrawal'
              : 'Service end',
          value: date,
        },
        { label: 'Refund', value: refundSummary.replace('Automatic refund: ', '') },
      ],
      action: { label: 'View my internet service', url: data.dashboardUrl },
      note,
    }),
  };
}

export function renderCancellationOperationalAlert(input: {
  brandLogoUrl: string;
  requestNumber: string;
  customerName: string;
  planName: string;
  reason: string;
  operationsUrl: string;
  providerSimulated: boolean;
}): RenderedEmailTemplate {
  const intro =
    'A service cancellation needs operational review. The subscription was not marked cancelled.';
  return {
    subject: `Cancellation requires review · ${input.requestNumber}`,
    text: [
      intro,
      `Reference: ${input.requestNumber}`,
      `Customer: ${input.customerName}`,
      `Plan: ${input.planName}`,
      `Reason: ${input.reason}`,
      `Review: ${input.operationsUrl}`,
    ].join('\n'),
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: intro,
      eyebrow: 'Operations alert',
      title: 'Cancellation requires review',
      intro,
      reference: input.requestNumber,
      statusLabel: 'Failed',
      tone: 'danger',
      internal: true,
      details: [
        { label: 'Customer', value: input.customerName },
        { label: 'Plan', value: input.planName },
        { label: 'Failure', value: input.reason },
      ],
      action: { label: 'Review cancellation', url: input.operationsUrl },
      note: input.providerSimulated
        ? 'The configured mock provider is only an internal simulation and does not disconnect a real wholesale service.'
        : 'Review the provider response before retrying or changing the service state.',
    }),
  };
}

function eventContent(
  event: CancellationEmailEvent,
  date: string,
  simulated: boolean,
  activationWithdrawal: boolean,
) {
  const simulationNote = simulated
    ? 'Development notice: this workflow uses an internal disconnection simulation. It is not confirmation of a real NBN or wholesale disconnection.'
    : 'Your invoices and payment history remain available in your account.';
  switch (event) {
    case 'APPROVED':
      return {
        title: 'Cancellation request approved',
        subjectSuffix: 'approved',
        status: 'Approved',
        tone: 'info' as const,
        intro: 'Your cancellation request has been approved. Operational processing can now begin.',
        note: 'Approval does not confirm that service disconnection has completed.',
      };
    case 'REJECTED':
      return {
        title: 'Cancellation request reviewed',
        subjectSuffix: 'reviewed',
        status: 'Not approved',
        tone: 'info' as const,
        intro:
          'Your cancellation request was not approved. View the request for the reason. Your existing service has not been changed.',
        note: 'Contact support if you need help with this decision.',
      };
    case 'REQUESTED':
      return {
        title: activationWithdrawal
          ? 'Service order withdrawal received'
          : 'Cancellation request submitted',
        subjectSuffix: activationWithdrawal ? 'withdrawal received' : 'request received',
        status: 'Awaiting review',
        tone: 'info' as const,
        intro: activationWithdrawal
          ? 'We have received the request to withdraw your pending service order.'
          : 'Your service cancellation request has been submitted and is awaiting employee review. Your service and billing continue normally until approval.',
        note: 'No Stripe cancellation, service disconnection or refund occurs before approval.',
      };
    case 'SCHEDULED':
      return {
        title: 'Cancellation scheduled',
        subjectSuffix: 'scheduled',
        status: 'Scheduled',
        tone: 'warning' as const,
        intro: `Your internet service is scheduled to remain available until ${date}.`,
        note: 'You can keep your service from the customer portal until disconnection processing begins.',
      };
    case 'REVOKED':
      return {
        title: 'Cancellation revoked',
        subjectSuffix: 'revoked',
        status: 'Service continuing',
        tone: 'success' as const,
        intro: 'Your scheduled cancellation was revoked and your internet service will continue.',
        note: 'Your existing plan and billing cycle remain in place.',
      };
    case 'COMPLETED':
      return {
        title: simulated ? 'Cancellation simulation completed' : 'Service cancellation completed',
        subjectSuffix: 'completed',
        status: 'Completed',
        tone: 'success' as const,
        intro: simulated
          ? 'The internal cancellation simulation has completed in Mero Telecom.'
          : `Your Mero Telecom internet service ended on ${date}.`,
        note: simulationNote,
      };
  }
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'long',
    timeZone: 'Australia/Adelaide',
  }).format(value);
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}
