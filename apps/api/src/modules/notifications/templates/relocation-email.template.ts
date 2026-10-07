import type { RenderedEmailTemplate } from './invoice-email.template';
import { renderCommunicationEmail } from './communication-email-layout';

export type RelocationEmailEvent =
  | 'REQUESTED'
  | 'REJECTED'
  | 'CONFIRMED'
  | 'SCHEDULED'
  | 'FAILED'
  | 'COMPLETED';

export function renderRelocationEmail(input: {
  event: RelocationEmailEvent;
  customerName: string;
  oldAddress: string;
  newAddress: string;
  planName: string;
  requestedMoveDate: Date;
  brandLogoUrl: string;
  dashboardUrl: string;
  failureReason?: string | null;
  newServiceActivated?: boolean;
}): RenderedEmailTemplate {
  const content = {
    REQUESTED: {
      subject: 'We received your moving home request',
      heading: 'Move home request submitted',
      message:
        'Your move home request is awaiting employee review. Your existing service, addresses and billing remain unchanged until approval and operational processing.',
    },
    REJECTED: {
      subject: 'Your move home request was reviewed',
      heading: 'Move home request reviewed',
      message:
        'Your move home request was not approved. View the request for the reason. Your existing service and addresses remain unchanged.',
    },
    CONFIRMED: {
      subject: 'Your move home request is approved',
      heading: 'Move home request approved',
      message:
        'We are preparing the new service. Your existing service will remain active until the new connection is ready.',
    },
    SCHEDULED: {
      subject: input.newServiceActivated
        ? 'Your new service address is active'
        : 'Your service relocation is scheduled',
      heading: input.newServiceActivated
        ? 'Waiting for old-service disconnection'
        : 'Provisioning is scheduled',
      message: input.newServiceActivated
        ? 'Your new connection is active. Your move remains in progress until the old service is disconnected.'
        : 'Your move home request has been approved. We will begin provisioning on the requested move date. Your existing connection remains unchanged in the meantime.',
    },
    FAILED: {
      subject: 'Action required for your service relocation',
      heading: 'We could not provision the new service',
      message:
        'Your existing service and service address are still active. Our team can investigate or retry the relocation.',
    },
    COMPLETED: {
      subject: 'Your service relocation is complete',
      heading: 'Your new service is active',
      message:
        'Your new service address is now active and the previous service has been closed through the relocation workflow.',
    },
  }[input.event];

  return {
    subject: content.subject,
    text: [
      `Hello ${input.customerName},`,
      content.message,
      `Moving from: ${input.oldAddress}`,
      `Moving to: ${input.newAddress}`,
      `Plan: ${input.planName}`,
      `Requested move: ${formatDate(input.requestedMoveDate)}`,
      ...(input.failureReason ? [`Details: ${input.failureReason}`] : []),
      `View status: ${input.dashboardUrl}`,
    ].join('\n\n'),
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: content.subject,
      eyebrow: 'MOVING HOME',
      title: content.heading,
      intro: content.message,
      recipientName: input.customerName,
      details: [
        { label: 'Moving from', value: input.oldAddress },
        { label: 'Moving to', value: input.newAddress },
        { label: 'Plan', value: input.planName },
        { label: 'Requested move', value: formatDate(input.requestedMoveDate) },
        ...(input.failureReason ? [{ label: 'Details', value: input.failureReason }] : []),
      ],
      action: { label: 'View relocation status', url: input.dashboardUrl },
    }),
  };
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Australia/Adelaide',
  }).format(value);
}
