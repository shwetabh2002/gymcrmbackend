import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type Transporter from 'nodemailer/lib/mailer';
import {
  EmailSendResult,
  SendEmailOptions,
  WelcomeSignupEmailInput,
} from './email.types';
import {
  welcomeSignupHtml,
  welcomeSignupSubject,
  welcomeSignupText,
} from './templates/welcome-signup.template';

/**
 * Injectable mailer for any feature (signup, invoices, resets…).
 *
 * Config (optional locally — falls back to console preview):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   MAIL_FROM  (e.g. "GymFlow <noreply@gymflow.app>")
 *   MAIL_ENABLED=true|false  (default: true when SMTP_HOST set)
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private fromAddress = 'GymFlow <noreply@localhost>';
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const port = Number(this.config.get<string>('SMTP_PORT') || 587);
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS')?.trim();
    const from = this.config.get<string>('MAIL_FROM')?.trim();
    const flag = this.config.get<string>('MAIL_ENABLED');

    if (from) this.fromAddress = from;

    const explicitlyOff =
      flag === 'false' || flag === '0' || flag === 'off';

    if (!host || explicitlyOff) {
      this.enabled = false;
      this.logger.warn(
        'Email: SMTP not configured (or MAIL_ENABLED=false) — emails will be logged only',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
    this.enabled = true;
    this.logger.log(
      `Email: SMTP ready → ${host}:${port} from=${this.fromAddress}`,
    );
  }

  /** Low-level send — use from any service via DI */
  async send(options: SendEmailOptions): Promise<EmailSendResult> {
    const payload = {
      from: this.fromAddress,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      cc: options.cc,
    };

    if (!this.enabled || !this.transporter) {
      this.logger.log(
        `[email:preview] to=${JSON.stringify(options.to)} subject="${options.subject}"`,
      );
      if (options.text) {
        this.logger.debug(options.text.slice(0, 500));
      }
      return { ok: true, preview: true };
    }

    try {
      const info = await this.transporter.sendMail(payload);
      this.logger.log(
        `Email sent to ${JSON.stringify(options.to)} id=${info.messageId}`,
      );
      return { ok: true, messageId: info.messageId };
    } catch (err: any) {
      const message = err?.message || String(err);
      this.logger.error(`Email failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  /** Welcome mail with login credentials after gym signup / onboard */
  async sendWelcomeSignup(
    input: WelcomeSignupEmailInput,
  ): Promise<EmailSendResult> {
    return this.send({
      to: input.to,
      subject: welcomeSignupSubject(input.gymName),
      html: welcomeSignupHtml(input),
      text: welcomeSignupText(input),
    });
  }
}
