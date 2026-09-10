import { humanizeEmailValue, renderCommunicationEmail } from './communication-email-layout';

export type SupportCustomerEvent = 'STAFF_REPLIED' | 'WAITING_FOR_CUSTOMER' | 'RESOLVED';

export function renderSupportCustomerEmail(input: {
  brandLogoUrl: string;
  event: SupportCustomerEvent;
  caseNumber: string;
  customerName: string;
  supportUrl: string;
}) {
  const content = {
    STAFF_REPLIED: {
      subject: `New reply on ${input.caseNumber}`,
      title: 'You have a new support reply',
      status: 'New reply',
      tone: 'info' as const,
      message: 'Mero Telecom Support has replied to your support request.',
      action: 'View support request',
    },
    WAITING_FOR_CUSTOMER: {
      subject: `More information is needed for ${input.caseNumber}`,
      title: 'We need some information from you',
      status: 'Action required',
      tone: 'warning' as const,
      message: 'Mero Telecom Support is waiting for your reply before work can continue.',
      action: 'Reply securely',
    },
    RESOLVED: {
      subject: `${input.caseNumber} has been resolved`,
      title: 'Your support request is resolved',
      status: 'Resolved',
      tone: 'success' as const,
      message: `Your support request ${input.caseNumber} has been marked as resolved. You can review the outcome in your account.`,
      action: 'Review resolution',
    },
  }[input.event];
  return {
    subject: content.subject,
    text: [
      `Hi ${input.customerName},`,
      '',
      content.message,
      '',
      `Reference: ${input.caseNumber}`,
      `${content.action}: ${input.supportUrl}`,
    ].join('\n'),
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: content.message,
      eyebrow: 'Customer support',
      title: content.title,
      recipientName: input.customerName,
      reference: input.caseNumber,
      statusLabel: content.status,
      tone: content.tone,
      intro: content.message,
      action: { label: content.action, url: input.supportUrl },
      note: 'Sign in to your Mero Telecom account to keep account-specific information secure.',
    }),
  };
}

export function renderNewSupportCaseEmail(input: {
  brandLogoUrl: string;
  caseNumber: string;
  customerName: string;
  customerEmail: string;
  subject: string;
  supportUrl: string;
}) {
  const intro = 'A new authenticated customer support request is ready for review.';
  return {
    subject: `New support request ${input.caseNumber}`,
    text: [
      intro,
      `Reference: ${input.caseNumber}`,
      `Customer: ${input.customerName} (${input.customerEmail})`,
      `Subject: ${input.subject}`,
      `Open request: ${input.supportUrl}`,
    ].join('\n'),
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: `${input.caseNumber} is ready for review.`,
      eyebrow: 'Support operations',
      title: 'New customer support request',
      reference: input.caseNumber,
      statusLabel: 'Unassigned',
      tone: 'info',
      intro,
      internal: true,
      details: [
        { label: 'Customer', value: input.customerName },
        { label: 'Email', value: input.customerEmail },
        { label: 'Subject', value: input.subject },
      ],
      action: { label: 'Open support request', url: input.supportUrl },
      note: 'Customer contact details are provided only for handling this support request.',
    }),
  };
}

export function renderAssignedSupportReplyEmail(input: {
  brandLogoUrl: string;
  caseNumber: string;
  supportUrl: string;
}) {
  const intro = 'The customer replied to a support request assigned to you.';
  return {
    subject: `Customer replied to ${input.caseNumber}`,
    text: `${intro}\n\nReference: ${input.caseNumber}\nOpen request: ${input.supportUrl}`,
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: `${input.caseNumber} has a new customer reply.`,
      eyebrow: 'Support operations',
      title: 'Customer reply received',
      reference: input.caseNumber,
      statusLabel: 'Response received',
      tone: 'info',
      intro,
      internal: true,
      action: { label: 'Open assigned request', url: input.supportUrl },
    }),
  };
}

export function renderNewProspectEnquiryEmail(input: {
  brandLogoUrl: string;
  caseNumber: string;
  prospectName: string;
  prospectEmail: string;
  subject: string;
  category: string;
  supportUrl: string;
}) {
  const intro = 'A new website enquiry is ready for review.';
  return {
    subject: `New pre-sales enquiry ${input.caseNumber}`,
    text: [
      intro,
      `Reference: ${input.caseNumber}`,
      `Prospect: ${input.prospectName} (${input.prospectEmail})`,
      `Category: ${humanizeEmailValue(input.category)}`,
      `Subject: ${input.subject}`,
      `Open enquiry: ${input.supportUrl}`,
    ].join('\n'),
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: `${input.caseNumber} is ready for review.`,
      eyebrow: 'Pre-sales support',
      title: 'New prospective customer enquiry',
      reference: input.caseNumber,
      statusLabel: 'Unassigned',
      tone: 'info',
      intro,
      internal: true,
      details: [
        { label: 'Prospect', value: input.prospectName },
        { label: 'Email', value: input.prospectEmail },
        { label: 'Category', value: humanizeEmailValue(input.category) },
        { label: 'Subject', value: input.subject },
      ],
      action: { label: 'Open enquiry', url: input.supportUrl },
      note: 'Treat prospect contact details as private information and use them only for this enquiry.',
    }),
  };
}

export function renderProspectEnquiryReceiptEmail(input: {
  brandLogoUrl: string;
  caseNumber: string;
  prospectName: string;
}) {
  const message =
    'Thanks for contacting Mero Telecom. Our support team will review your enquiry and reply to this email address.';
  return {
    subject: `We received your enquiry ${input.caseNumber}`,
    text: [`Hi ${input.prospectName},`, '', message, '', `Reference: ${input.caseNumber}`].join(
      '\n',
    ),
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: `We received enquiry ${input.caseNumber}.`,
      eyebrow: 'Help & contact',
      title: 'Thanks for getting in touch',
      recipientName: input.prospectName,
      reference: input.caseNumber,
      statusLabel: 'Received',
      tone: 'success',
      intro: message,
      note: 'Keep your reference handy if you contact us again. You do not need an account for this enquiry.',
    }),
  };
}

export function renderProspectSupportEmail(input: {
  brandLogoUrl: string;
  event: SupportCustomerEvent;
  caseNumber: string;
  prospectName: string;
  messageBody?: string;
}) {
  const content = {
    STAFF_REPLIED: {
      subject: `Mero Telecom replied to ${input.caseNumber}`,
      title: 'A reply from Mero Telecom',
      status: 'New reply',
      tone: 'info' as const,
      message: 'Our support team has replied to your enquiry.',
    },
    WAITING_FOR_CUSTOMER: {
      subject: `More information is needed for ${input.caseNumber}`,
      title: 'We need a little more information',
      status: 'Action required',
      tone: 'warning' as const,
      message: 'Our support team needs more information. Please reply directly to this email.',
    },
    RESOLVED: {
      subject: `${input.caseNumber} has been resolved`,
      title: 'Your enquiry is resolved',
      status: 'Resolved',
      tone: 'success' as const,
      message: 'Your enquiry has been marked as resolved.',
    },
  }[input.event];
  const response = input.messageBody?.trim();
  return {
    subject: content.subject,
    text: [
      `Hi ${input.prospectName},`,
      '',
      content.message,
      ...(response ? ['', response] : []),
      '',
      `Reference: ${input.caseNumber}`,
    ].join('\n'),
    html: renderCommunicationEmail({
      brandLogoUrl: input.brandLogoUrl,
      preheader: content.message,
      eyebrow: 'Mero Telecom support',
      title: content.title,
      recipientName: input.prospectName,
      reference: input.caseNumber,
      statusLabel: content.status,
      tone: content.tone,
      intro: content.message,
      message: response,
      note:
        input.event === 'WAITING_FOR_CUSTOMER'
          ? 'Reply to this email and include the reference above so our team can continue helping you.'
          : 'Keep this reference if you need to contact Mero Telecom again.',
    }),
  };
}
