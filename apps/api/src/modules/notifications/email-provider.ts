export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  messageId: string;
}

export abstract class EmailProvider {
  abstract send(message: EmailMessage): Promise<EmailSendResult>;
}
