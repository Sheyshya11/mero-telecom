export type InternalRequestStaffEvent =
  | 'REVIEW_STARTED'
  | 'MORE_INFO_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ADMIN_REPLIED'
  | 'RESOLVED'
  | 'CLOSED'
  | 'ESCALATED'
  | 'SUPER_ADMIN_REPLIED'
  | 'SUPER_ADMIN_REVIEW_STARTED'
  | 'SUPER_ADMIN_MORE_INFO_REQUIRED'
  | 'SUPER_ADMIN_APPROVED'
  | 'SUPER_ADMIN_REJECTED'
  | 'RETURNED_TO_ADMIN';

export type InternalRequestSuperAdminEvent = 'ESCALATED' | 'ADMIN_REPLIED' | 'STAFF_REPLIED';

export type InternalRequestAdminEscalationEvent =
  | 'SUPER_ADMIN_REVIEW_STARTED'
  | 'SUPER_ADMIN_REPLIED'
  | 'MORE_INFO_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'RESOLVED'
  | 'CLOSED';

export function renderNewInternalRequestEmail(input: {
  brandLogoUrl: string;
  requestNumber: string;
  requesterName: string;
  type: string;
  priority: string;
  requestUrl: string;
}) {
  const priorityPrefix = input.priority === 'HIGH' ? 'High priority: ' : '';
  const message = `${input.requesterName} submitted an internal request for Admin review.`;
  return {
    subject: `${priorityPrefix}New internal request ${input.requestNumber}`,
    text: [
      message,
      `Request: ${input.requestNumber}`,
      `Type: ${humanizeEmailValue(input.type)}`,
      `Priority: ${humanizeEmailValue(input.priority)}`,
      `Review request: ${input.requestUrl}`,
    ].join('\n'),
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: `${input.requestNumber} requires Admin review.`,
      eyebrow: 'Internal operations',
      title: 'New internal request',
      reference: input.requestNumber,
      statusLabel: input.priority === 'HIGH' ? 'High priority' : 'Pending review',
      tone: input.priority === 'HIGH' ? 'danger' : 'info',
      intro: message,
      internal: true,
      details: [
        { label: 'Requested by', value: input.requesterName },
        { label: 'Request type', value: humanizeEmailValue(input.type) },
        { label: 'Priority', value: humanizeEmailValue(input.priority) },
      ],
      action: { label: 'Review internal request', url: input.requestUrl },
      note: 'Review the complete conversation and related customer context inside the secure Control Centre.',
    }),
  };
}

export function renderInternalRequestStaffEmail(input: {
  brandLogoUrl: string;
  event: InternalRequestStaffEvent;
  requestNumber: string;
  staffName: string;
  requestUrl: string;
}) {
  const content = {
    REVIEW_STARTED: ['Admin started reviewing your request.', 'Review started'],
    MORE_INFO_REQUIRED: ['Admin needs more information from you.', 'More information required'],
    APPROVED: [
      'Admin approved your request. Any underlying business action must still be completed separately.',
      'Request approved',
    ],
    REJECTED: ['Admin rejected your request. Open it to review the reason.', 'Request rejected'],
    ADMIN_REPLIED: ['Admin replied to your internal request.', 'New Admin reply'],
    RESOLVED: ['Admin marked the internal request as resolved.', 'Request resolved'],
    CLOSED: ['Admin closed the internal request.', 'Request closed'],
    ESCALATED: ['Admin escalated your request to Super Admin for review.', 'Request escalated'],
    SUPER_ADMIN_REPLIED: ['Super Admin replied to your internal request.', 'New Super Admin reply'],
    SUPER_ADMIN_REVIEW_STARTED: [
      'Super Admin started reviewing your escalated request.',
      'Super Admin review started',
    ],
    SUPER_ADMIN_MORE_INFO_REQUIRED: [
      'Super Admin needs more information about your request.',
      'More information required',
    ],
    SUPER_ADMIN_APPROVED: [
      'Super Admin approved your request. Any underlying business action must still be completed separately.',
      'Request approved by Super Admin',
    ],
    SUPER_ADMIN_REJECTED: [
      'Super Admin rejected your request. Open it to review the reason.',
      'Request rejected by Super Admin',
    ],
    RETURNED_TO_ADMIN: [
      'Super Admin returned your request to Admin for the next operational step.',
      'Request returned to Admin',
    ],
  }[input.event];
  return {
    subject: `${content[1]} · ${input.requestNumber}`,
    text: [`Hi ${input.staffName},`, '', content[0], '', `Open request: ${input.requestUrl}`].join(
      '\n',
    ),
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: `${content[1]} for ${input.requestNumber}.`,
      eyebrow: 'Internal request update',
      title: content[1],
      recipientName: input.staffName,
      reference: input.requestNumber,
      statusLabel: internalStatus(input.event),
      tone: internalTone(input.event),
      intro: content[0],
      internal: true,
      action: { label: 'Open internal request', url: input.requestUrl },
      note: 'Do not forward internal decisions or notes to customers. Write a separate customer-appropriate response when required.',
    }),
  };
}

export function renderInternalRequestSuperAdminEmail(input: {
  brandLogoUrl: string;
  event: InternalRequestSuperAdminEvent;
  requestNumber: string;
  priority?: string;
  requestUrl: string;
}) {
  const content = {
    ESCALATED: ['An Admin escalated an internal request for your review.', 'New escalation'],
    ADMIN_REPLIED: ['The assigned Admin replied to an escalated request.', 'Admin replied'],
    STAFF_REPLIED: [
      'The original Staff requester replied to an escalated request.',
      'Staff replied',
    ],
  }[input.event];
  const priorityPrefix = input.priority === 'HIGH' ? 'High priority: ' : '';
  return {
    subject: `${priorityPrefix}${content[1]} · ${input.requestNumber}`,
    text: `${content[0]}\n\nOpen escalation: ${input.requestUrl}`,
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: `${content[1]} for ${input.requestNumber}.`,
      eyebrow: 'Super Admin escalation',
      title: content[1],
      reference: input.requestNumber,
      statusLabel: input.event === 'ESCALATED' ? 'Decision required' : 'New information',
      tone: input.priority === 'HIGH' ? 'danger' : 'warning',
      intro: content[0],
      internal: true,
      action: { label: 'Review escalation', url: input.requestUrl },
      note: 'Approval authorises a decision only; no refund, subscription, billing or account action is executed by this email.',
    }),
  };
}

export function renderInternalRequestAdminEscalationEmail(input: {
  brandLogoUrl: string;
  event: InternalRequestAdminEscalationEvent;
  requestNumber: string;
  requestUrl: string;
}) {
  const content = {
    SUPER_ADMIN_REVIEW_STARTED: ['Super Admin started reviewing the escalation.', 'Review started'],
    SUPER_ADMIN_REPLIED: ['Super Admin replied to the escalated request.', 'Super Admin replied'],
    MORE_INFO_REQUIRED: ['Super Admin requested more information.', 'More information required'],
    APPROVED: [
      'Super Admin approved the request. No business action was executed automatically.',
      'Escalation approved',
    ],
    REJECTED: [
      'Super Admin rejected the request. Open it to review the reason.',
      'Escalation rejected',
    ],
    RETURNED: ['Super Admin returned the request to Admin for follow-up.', 'Returned to Admin'],
    RESOLVED: ['Super Admin marked the request as resolved.', 'Request resolved'],
    CLOSED: ['Super Admin closed the request.', 'Request closed'],
  }[input.event];
  return {
    subject: `${content[1]} · ${input.requestNumber}`,
    text: `${content[0]}\n\nOpen request: ${input.requestUrl}`,
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: `${content[1]} for ${input.requestNumber}.`,
      eyebrow: 'Super Admin decision',
      title: content[1],
      reference: input.requestNumber,
      statusLabel: internalStatus(input.event),
      tone: internalTone(input.event),
      intro: content[0],
      internal: true,
      action: { label: 'Open internal request', url: input.requestUrl },
      note: 'Complete and verify any approved operational action through its existing Mero Telecom workflow before resolving the request.',
    }),
  };
}

export function renderAssignedInternalRequestReplyEmail(input: {
  brandLogoUrl: string;
  requestNumber: string;
  requestUrl: string;
  resumedReview: boolean;
}) {
  const message = input.resumedReview
    ? 'Staff supplied the requested information. The request is back in review.'
    : 'Staff replied to your assigned internal request.';
  return {
    subject: `Staff replied to ${input.requestNumber}`,
    text: `${message}\n\nOpen request: ${input.requestUrl}`,
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: `${input.requestNumber} has a new Staff reply.`,
      eyebrow: 'Internal request update',
      title: input.resumedReview ? 'Information received' : 'Staff replied',
      reference: input.requestNumber,
      statusLabel: input.resumedReview ? 'Back in review' : 'New reply',
      tone: 'info',
      intro: message,
      internal: true,
      action: { label: 'Continue review', url: input.requestUrl },
    }),
  };
}

function internalStatus(event: string): string {
  const labels: Record<string, string> = {
    MORE_INFO_REQUIRED: 'Action required',
    SUPER_ADMIN_MORE_INFO_REQUIRED: 'Action required',
    APPROVED: 'Approved',
    SUPER_ADMIN_APPROVED: 'Approved',
    REJECTED: 'Rejected',
    SUPER_ADMIN_REJECTED: 'Rejected',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
    ESCALATED: 'Escalated',
    RETURNED: 'Returned',
    RETURNED_TO_ADMIN: 'Returned to Admin',
  };
  return labels[event] ?? humanizeEmailValue(event);
}

function internalTone(event: string): 'info' | 'success' | 'warning' | 'danger' {
  if (event.includes('REJECTED')) return 'danger';
  if (event.includes('APPROVED') || event === 'RESOLVED' || event === 'CLOSED') return 'success';
  if (event.includes('MORE_INFO') || event === 'ESCALATED' || event === 'RETURNED')
    return 'warning';
  return 'info';
}
import { humanizeEmailValue, renderCommunicationEmail } from './communication-email-layout';
