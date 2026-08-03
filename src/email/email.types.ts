export type SendEmailOptions = {
  /** Primary recipient */
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Optional reply-to */
  replyTo?: string;
  /** Optional CC */
  cc?: string | string[];
};

export type EmailSendResult = {
  ok: boolean;
  /** nodemailer messageId when actually sent */
  messageId?: string;
  /** true when SMTP is not configured and we only logged */
  preview?: boolean;
  error?: string;
};

export type WelcomeSignupEmailInput = {
  to: string;
  adminName: string;
  gymName: string;
  email: string;
  password: string;
  loginUrl: string;
};
