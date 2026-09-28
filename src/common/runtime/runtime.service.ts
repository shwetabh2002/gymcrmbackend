import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RAZORPAY_WEBHOOK_PATH } from '../../config/razorpay.config';
import { PLATFORM_TAX_PERCENTAGE } from '../../config/platform-billing.config';

/** Local development fallbacks — production always supplies real URLs. */
const LOCAL_ORIGIN = 'http://localhost';
const DEFAULT_PORT = 5000;
const DEFAULT_CRM_PORT = 3000;

/** Used where a provider requires an address but no member email exists. */
const SYSTEM_EMAIL = 'noreply@gym.local';

/**
 * Env values that ship as placeholders. Production must not run on any of them.
 *
 * Only secrets the code actually uses belong here — refusing to boot over an
 * unused variable is noise, not safety.
 */
const DEV_PLACEHOLDER_SECRETS: Record<string, string[]> = {
  JWT_ACCESS_SECRET: [
    'your-access-secret-key-change-this-in-production',
    'change-me-access-secret',
  ],
  JWT_REFRESH_SECRET: [
    'your-refresh-secret-key-change-this-in-production',
    'change-me-refresh-secret',
  ],
  PAYMENT_TOKEN_ENCRYPTION_KEY: [
    'dev-payment-token-key-change-me',
    'change-me-payment-token-key',
  ],
};

/**
 * Single source of truth for "what is allowed in this environment".
 *
 * Every mock / shortcut in the payment + messaging stack asks this service
 * instead of reading NODE_ENV itself, so production can never fall back to a
 * fake provider just because an env flag was left behind.
 */
@Injectable()
export class RuntimeService {
  private readonly logger = new Logger(RuntimeService.name);

  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return (this.config.get<string>('NODE_ENV') || 'development').trim();
  }

  isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  /**
   * Mock payment providers are OFF by default.
   * Only an explicit RAZORPAY_ALLOW_MOCK=true enables them (never in production).
   */
  mockAllowed(): boolean {
    if (this.isProduction()) return false;
    return this.config.get<string>('RAZORPAY_ALLOW_MOCK') === 'true';
  }

  /** WhatsApp mock auto-send — explicit opt-in only; never in production. */
  whatsappMockAllowed(): boolean {
    if (this.isProduction()) return false;
    return this.config.get<string>('WHATSAPP_ALLOW_MOCK') === 'true';
  }

  /**
   * Webhook signatures are always verified — forged payment events must not
   * activate subscriptions or mark checkouts paid.
   */
  requireWebhookSignature(): boolean {
    return true;
  }

  port(): number {
    return Number(this.config.get<string>('PORT')) || DEFAULT_PORT;
  }

  private static stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
  }

  /** Where this API is reachable from the outside world. */
  backendPublicUrl(): string {
    return RuntimeService.stripTrailingSlash(
      this.config.get<string>('BACKEND_PUBLIC_URL') ||
        `${LOCAL_ORIGIN}:${this.port()}`,
    );
  }

  /** Staff-facing CRM app. */
  crmPublicUrl(): string {
    return RuntimeService.stripTrailingSlash(
      this.config.get<string>('CRM_PUBLIC_URL') ||
        this.config.get<string>('FRONTEND_URL') ||
        `${LOCAL_ORIGIN}:${DEFAULT_CRM_PORT}`,
    );
  }

  /** Public marketing + self-signup (same app as CRM after merge). */
  marketingUrl(): string {
    return RuntimeService.stripTrailingSlash(
      this.config.get<string>('MARKETING_URL') || this.crmPublicUrl(),
    );
  }

  /** Browser origins allowed to call this API. */
  corsOrigins(): string[] {
    const extra = (this.config.get<string>('ADDITIONAL_CORS_ORIGINS') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set([this.crmPublicUrl(), this.marketingUrl(), ...extra])];
  }

  /** Page a member lands on after a self-signup or a payment redirect. */
  crmUrl(path = ''): string {
    if (!path) return this.crmPublicUrl();
    return `${this.crmPublicUrl()}/${path.replace(/^\/+/, '')}`;
  }

  /** Public URL a gym pastes into the Razorpay dashboard. */
  razorpayWebhookUrl(): string {
    return `${this.backendPublicUrl()}/${RAZORPAY_WEBHOOK_PATH}`;
  }

  /** Dev-only simulated payment page for a link id. */
  razorpayMockPayUrl(linkId: string, withToken = false): string {
    const query = withToken ? '?token=1' : '';
    return `${this.backendPublicUrl()}/${RAZORPAY_WEBHOOK_PATH}/mock-pay/${linkId}${query}`;
  }

  /**
   * GST we add to our own subscription invoices. SaaS in India is taxable;
   * rate is a code constant (platform-billing.config), not env.
   */
  platformTaxPercentage(): number {
    return PLATFORM_TAX_PERCENTAGE;
  }

  /** Fallback sender address for provider calls that demand one. */
  systemEmail(): string {
    return this.config.get<string>('MAIL_SYSTEM_ADDRESS') || SYSTEM_EMAIL;
  }

  /**
   * Boot-time guard rails. Returns the list of blocking problems so main.ts can
   * refuse to start a production server with development secrets.
   */
  productionProblems(): string[] {
    if (!this.isProduction()) return [];

    const problems: string[] = [];

    for (const [key, bad] of Object.entries(DEV_PLACEHOLDER_SECRETS)) {
      const value = (this.config.get<string>(key) || '').trim();
      if (!value) {
        problems.push(`${key} is not set`);
      } else if (bad.includes(value)) {
        problems.push(`${key} still holds its development placeholder`);
      }
    }

    if (!(this.config.get<string>('RAZORPAY_WEBHOOK_SECRET') || '').trim()) {
      problems.push(
        'RAZORPAY_WEBHOOK_SECRET is not set (needed unless every gym stores its own secret)',
      );
    }

    if (this.config.get<string>('RAZORPAY_ALLOW_MOCK') === 'true') {
      problems.push('RAZORPAY_ALLOW_MOCK=true is not allowed in production');
    }
    if (this.config.get<string>('WHATSAPP_ALLOW_MOCK') === 'true') {
      problems.push('WHATSAPP_ALLOW_MOCK=true is not allowed in production');
    }
    if (this.config.get<string>('RAZORPAY_SKIP_WEBHOOK_VERIFY') === 'true') {
      problems.push(
        'RAZORPAY_SKIP_WEBHOOK_VERIFY=true is ignored in production — remove it',
      );
    }

    // Localhost URLs in production mean webhooks and email links point nowhere.
    const publicUrls: Record<string, string> = {
      BACKEND_PUBLIC_URL: this.config.get<string>('BACKEND_PUBLIC_URL') || '',
      CRM_PUBLIC_URL:
        this.config.get<string>('CRM_PUBLIC_URL') ||
        this.config.get<string>('FRONTEND_URL') ||
        '',
    };
    for (const [key, value] of Object.entries(publicUrls)) {
      if (!value.trim()) {
        problems.push(`${key} must be set to the real public URL`);
      } else if (/localhost|127\.0\.0\.1/.test(value)) {
        problems.push(`${key} still points at localhost`);
      }
    }

    return problems;
  }

  logMode() {
    this.logger.log(
      `Runtime: env=${this.nodeEnv} mocks=${this.mockAllowed() ? 'allowed' : 'blocked'} ` +
        `webhookSignature=${this.requireWebhookSignature() ? 'required' : 'skipped'}`,
    );
  }
}
