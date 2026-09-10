import type { RenderedEmailTemplate } from './invoice-email.template';
import { renderCommunicationEmail } from './communication-email-layout';

export type CancellationEmailEvent = 'REQUESTED' | 'SCHEDULED' | 'REVOKED' | 'COMPLETED';

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
}

export function renderCancellationEmail(data: CancellationEmailData): RenderedEmailTemplate {
  const date = formatDate(data.effectiveAt);
  const activationWithdrawal = data.providerOperation === 'WITHDRAW_ACTIVATION';
  const content = eventContent(data.event, date, data.providerSimulated, activationWithdrawal);
  return {
    subject: `Mero Telecom cancellation ${content.subjectSuffix} · ${data.requestNumber}`,
    text: [
      `Hi ${data.customerName},`,
      '',
      content.intro,
      `Reference: ${data.requestNumber}`,
      `Plan: ${data.planName}`,
      `${activationWithdrawal ? 'Requested withdrawal' : 'Service end'}: ${date}`,
      '',
      content.note,
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
        { label: activationWithdrawal ? 'Requested withdrawal' : 'Service end', value: date },
      ],
      action: { label: 'View my internet service', url: data.dashboardUrl },
      note: content.note,
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
    case 'REQUESTED':
      return {
        title: activationWithdrawal
          ? 'Service order withdrawal received'
          : 'Cancellation request received',
        subjectSuffix: activationWithdrawal ? 'withdrawal received' : 'request received',
        status: 'Received',
        tone: 'info' as const,
        intro: activationWithdrawal
          ? 'We have received the request to withdraw your pending service order.'
          : 'We have received your service cancellation request.',
        note: 'No refund is issued automatically. Any applicable adjustment is handled through the existing billing and refund process.',
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
