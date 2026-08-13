import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

import type { AppConfig } from '../../config/configuration';
import { EmailProvider, type EmailMessage, type EmailSendResult } from './email-provider';

@Injectable()
export class NodemailerEmailProvider implements EmailProvider {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    const config = configService.getOrThrow('email');
    const auth = config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined;

    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const result = await this.transporter.sendMail({
      from: this.from,
      ...message,
    });
    return { messageId: result.messageId };
  }
}
