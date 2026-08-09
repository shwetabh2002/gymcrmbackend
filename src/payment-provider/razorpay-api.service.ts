import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { RuntimeService } from '../common/runtime/runtime.service';
import { getCountry } from '../config/countries.config';
import {
  MANDATE_FREQUENCY,
  MandateMethod,
  DEFAULT_MANDATE_METHOD,
  RAZORPAY_API_BASE_URL,
  RAZORPAY_AUTH_BASE_URL,
  RAZORPAY_OAUTH_CALLBACK_PATH,
  RAZORPAY_OAUTH_PATHS,
  RAZORPAY_OAUTH_SCOPES,
  RAZORPAY_PATHS,
  RAZORPAY_PAYMENT_STATUS,
} from '../config/razorpay.config';

export type RazorpayCredentials =
  | { mode: 'oauth'; accessToken: string }
  | { mode: 'api_keys'; keyId: string; keySecret: string }
  | { mode: 'mock' };

export type CreatePaymentLinkInput = {
  amountPaise: number;
  currency?: string;
  customer: { name: string; contact: string; email?: string };
  description: string;
  callbackUrl?: string;
  notes?: Record<string, string>;
};

export type CreatePaymentLinkResult = {
  id: string;
  shortUrl: string;
  orderId: string | null;
  customerId: string | null;
  qrData: string;
  mock?: boolean;
};

/**
 * A UPI Autopay (or e-mandate) registration link. Razorpay calls this an
 * "authorization transaction": the member approves a mandate AND pays the first
 * amount in one step. A plain payment link cannot create a mandate.
 */
export type CreateAuthLinkInput = {
  /** First debit collected while the mandate is approved. */
  amountPaise: number;
  currency?: string;
  customer: { name: string; contact: string; email?: string };
  description: string;
  /** Ceiling Razorpay may debit per charge without re-authorisation. */
  maxAmountPaise: number;
  /** Unix seconds — when the mandate itself stops being valid. */
  mandateExpireAt: number;
  /** Unix seconds — when the *link* stops being payable. */
  linkExpireAt?: number;
  method?: MandateMethod;
  notes?: Record<string, string>;
  receipt?: string;
};

export type CreateAuthLinkResult = {
  /** Razorpay invoice id (inv_…) for the registration link. */
  id: string;
  shortUrl: string;
  orderId: string | null;
  customerId: string | null;
  qrData: string;
  maxAmountPaise: number;
  mandateExpireAt: number;
  method: string;
  mock?: boolean;
};

export type ChargeTokenResult = {
  paymentId: string;
  orderId: string;
  /** created | authorized | captured | failed */
  status: string;
};

@Injectable()
export class RazorpayApiService {
  private readonly logger = new Logger(RazorpayApiService.name);
  private readonly baseUrl = RAZORPAY_API_BASE_URL;

  constructor(
    private config: ConfigService,
    private runtime: RuntimeService,
  ) {}

  // ───────────────────────── Partner OAuth ─────────────────────────

  getPartnerClientId() {
    return this.config.get<string>('RAZORPAY_PARTNER_CLIENT_ID') || '';
  }

  getPartnerClientSecret() {
    return this.config.get<string>('RAZORPAY_PARTNER_CLIENT_SECRET') || '';
  }

  /**
   * Where Razorpay sends the browser back with `code` + `state`.
   *
   * This must be the API's own callback route — it is the only place that can
   * exchange the code for tokens. It also has to match the redirect URI
   * registered in the Razorpay Partner dashboard exactly.
   */
  getOAuthRedirectUri() {
    return (
      this.config.get<string>('RAZORPAY_PARTNER_REDIRECT_URI') ||
      `${this.runtime.backendPublicUrl()}/${RAZORPAY_OAUTH_CALLBACK_PATH}`
    );
  }

  isPartnerConfigured() {
    return !!(this.getPartnerClientId() && this.getPartnerClientSecret());
  }

  buildAuthorizeUrl(state: string) {
    const clientId = this.getPartnerClientId();
    const redirect = encodeURIComponent(this.getOAuthRedirectUri());
    const scopes = encodeURIComponent(RAZORPAY_OAUTH_SCOPES.join(' '));
    const query = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      state,
    });
    // redirect_uri / scope are pre-encoded above to keep Razorpay's exact format.
    return `${RAZORPAY_AUTH_BASE_URL}${RAZORPAY_OAUTH_PATHS.authorize}?${query.toString()}&redirect_uri=${redirect}&scope=${scopes}`;
  }

  async exchangeCodeForTokens(code: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    razorpay_account_id?: string;
    public_token?: string;
  }> {
    const body = new URLSearchParams({
      client_id: this.getPartnerClientId(),
      client_secret: this.getPartnerClientSecret(),
      grant_type: 'authorization_code',
      redirect_uri: this.getOAuthRedirectUri(),
      code,
      // Live gyms must authorise the live account; only dev uses test mode.
      mode: this.runtime.isProduction() ? 'live' : 'test',
    });
    const res = await fetch(
      `${RAZORPAY_AUTH_BASE_URL}${RAZORPAY_OAUTH_PATHS.token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`OAuth token exchange failed: ${res.status} ${text}`);
      throw new BadGatewayException(
        `Razorpay refused the authorisation (${res.status}). Try connecting again.`,
      );
    }
    return res.json();
  }

  async refreshAccessToken(refreshToken: string) {
    const body = new URLSearchParams({
      client_id: this.getPartnerClientId(),
      client_secret: this.getPartnerClientSecret(),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const res = await fetch(
      `${RAZORPAY_AUTH_BASE_URL}${RAZORPAY_OAUTH_PATHS.token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    if (!res.ok) {
      // The gym must re-authorise; getCredentials marks the account NEEDS_REAUTH.
      throw new ServiceUnavailableException(
        `Razorpay connection expired and could not be refreshed (${res.status}). Reconnect in Settings.`,
      );
    }
    return res.json();
  }

  // ───────────────────────── HTTP plumbing ─────────────────────────

  /**
   * Settlement currency of the Razorpay account. A gym's display currency comes
   * from its country config; this is what the provider is asked to charge in.
   */
  private defaultCurrency(): string {
    return (
      this.config.get<string>('PAYMENT_CURRENCY') ||
      getCountry(this.config.get<string>('DEFAULT_COUNTRY_CODE')).currency
    );
  }

  private authHeader(creds: RazorpayCredentials): Record<string, string> {
    if (creds.mode === 'oauth') {
      return { Authorization: `Bearer ${creds.accessToken}` };
    }
    if (creds.mode === 'api_keys') {
      const basic = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString(
        'base64',
      );
      return { Authorization: `Basic ${basic}` };
    }
    return {};
  }

  private async call<T>(
    creds: RazorpayCredentials,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeader(creds),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) {
      this.logger.error(`Razorpay ${method} ${path} → ${res.status} ${text}`);
      let description = '';
      try {
        description = JSON.parse(text)?.error?.description || '';
      } catch {
        // non-JSON body — fall back to the status code alone
      }
      /**
       * Surfaced as a gateway error, not a bare Error: the front desk must see
       * "Razorpay: <reason>" instead of a blank 500 when the provider rejects a
       * link or a charge.
       */
      throw new BadGatewayException(
        description
          ? `Razorpay: ${description}`
          : `Razorpay request failed (${res.status}). Check the gym's Razorpay connection in Settings.`,
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  // ───────────────────────── Customers ─────────────────────────

  /**
   * Razorpay needs a customer to hang a mandate token off. Idempotent by
   * contact: an existing customer is returned instead of erroring.
   */
  async createCustomer(
    creds: RazorpayCredentials,
    input: { name: string; contact: string; email?: string },
  ): Promise<string | null> {
    if (creds.mode === 'mock') {
      return `cust_mock_${randomBytes(4).toString('hex')}`;
    }
    try {
      const data = await this.call<{ id: string }>(
        creds,
        'POST',
        RAZORPAY_PATHS.customers,
        {
          name: input.name,
          contact: input.contact,
          ...(input.email ? { email: input.email } : {}),
          fail_existing: '0', // return the existing customer instead of 400
        },
      );
      return data.id || null;
    } catch (err) {
      // A missing customer is not fatal — auth_links creates one itself.
      this.logger.warn(
        `createCustomer failed, continuing without it: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return null;
    }
  }

  // ───────────────────────── One-time payment link ─────────────────────────

  async createPaymentLink(
    creds: RazorpayCredentials,
    input: CreatePaymentLinkInput,
  ): Promise<CreatePaymentLinkResult> {
    if (creds.mode === 'mock') {
      const id = `plink_mock_${randomBytes(6).toString('hex')}`;
      const shortUrl = this.runtime.razorpayMockPayUrl(id, false);
      return {
        id,
        shortUrl,
        orderId: `order_mock_${randomBytes(6).toString('hex')}`,
        customerId: `cust_mock_${randomBytes(4).toString('hex')}`,
        qrData: shortUrl,
        mock: true,
      };
    }

    const data = await this.call<any>(
      creds,
      'POST',
      RAZORPAY_PATHS.paymentLinks,
      {
        amount: input.amountPaise,
        currency: input.currency || this.defaultCurrency(),
        accept_partial: false,
        description: input.description,
        customer: {
          name: input.customer.name,
          contact: input.customer.contact,
          ...(input.customer.email ? { email: input.customer.email } : {}),
        },
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: input.notes || {},
        ...(input.callbackUrl
          ? { callback_url: input.callbackUrl, callback_method: 'get' }
          : {}),
      },
    );

    return {
      id: data.id,
      shortUrl: data.short_url,
      orderId: data.order_id || null,
      customerId: data.customer?.id || null,
      qrData: data.short_url,
    };
  }

  // ───────────────────────── Mandate registration link ─────────────────────────

  /**
   * Creates a Razorpay authorization link (`/subscription_registration/auth_links`).
   * The member approves a UPI Autopay mandate and pays `amountPaise` in one go;
   * Razorpay then emits `token.confirmed` / `invoice.paid` with the token id we
   * charge against later.
   */
  async createAuthorizationLink(
    creds: RazorpayCredentials,
    input: CreateAuthLinkInput,
  ): Promise<CreateAuthLinkResult> {
    const method: MandateMethod = input.method || DEFAULT_MANDATE_METHOD;

    if (creds.mode === 'mock') {
      const id = `inv_mock_${randomBytes(6).toString('hex')}`;
      const shortUrl = this.runtime.razorpayMockPayUrl(id, true);
      return {
        id,
        shortUrl,
        orderId: `order_mock_${randomBytes(6).toString('hex')}`,
        customerId: `cust_mock_${randomBytes(4).toString('hex')}`,
        qrData: shortUrl,
        maxAmountPaise: input.maxAmountPaise,
        mandateExpireAt: input.mandateExpireAt,
        method,
        mock: true,
      };
    }

    const data = await this.call<any>(creds, 'POST', RAZORPAY_PATHS.authLinks, {
      customer: {
        name: input.customer.name,
        contact: input.customer.contact,
        ...(input.customer.email ? { email: input.customer.email } : {}),
      },
      type: 'link',
      amount: input.amountPaise,
      currency: input.currency || this.defaultCurrency(),
      description: input.description,
      subscription_registration: {
        method,
        max_amount: input.maxAmountPaise,
        expire_at: input.mandateExpireAt,
        frequency: MANDATE_FREQUENCY,
      },
      ...(input.receipt ? { receipt: input.receipt } : {}),
      ...(input.linkExpireAt ? { expire_by: input.linkExpireAt } : {}),
      sms_notify: 0,
      email_notify: 0,
      notes: input.notes || {},
    });

    return {
      id: data.id,
      shortUrl: data.short_url,
      orderId: data.order_id || null,
      customerId: data.customer_id || data.customer?.id || null,
      qrData: data.short_url,
      maxAmountPaise: input.maxAmountPaise,
      mandateExpireAt: input.mandateExpireAt,
      method,
    };
  }

  // ───────────────────────── Recurring charge ─────────────────────────

  /**
   * Debit a saved mandate token ("charge at will").
   * `captured` = money collected now; `created`/`authorized` = Razorpay will
   * confirm asynchronously via the payment.captured / payment.failed webhook.
   */
  async chargeToken(
    creds: RazorpayCredentials,
    input: {
      amountPaise: number;
      tokenId: string;
      customerId: string;
      receipt: string;
      /** Razorpay rejects recurring charges without a contactable customer. */
      email: string;
      contact: string;
      notes?: Record<string, string>;
    },
  ): Promise<ChargeTokenResult> {
    if (creds.mode === 'mock') {
      return {
        paymentId: `pay_mock_${randomBytes(6).toString('hex')}`,
        orderId: `order_mock_${randomBytes(6).toString('hex')}`,
        status: RAZORPAY_PAYMENT_STATUS.captured,
      };
    }

    const order = await this.call<any>(creds, 'POST', RAZORPAY_PATHS.orders, {
      amount: input.amountPaise,
      currency: this.defaultCurrency(),
      payment_capture: true,
      receipt: input.receipt,
      notes: input.notes || {},
    });

    const payment = await this.call<any>(
      creds,
      'POST',
      RAZORPAY_PATHS.recurringPayment,
      {
        email: input.email,
        contact: input.contact,
        amount: input.amountPaise,
        currency: this.defaultCurrency(),
        order_id: order.id,
        customer_id: input.customerId,
        token: input.tokenId,
        recurring: '1',
        description: 'Gym membership autopay',
        notes: input.notes || {},
      },
    );

    return {
      paymentId: payment.razorpay_payment_id || payment.id,
      orderId: order.id,
      status: payment.status || RAZORPAY_PAYMENT_STATUS.created,
    };
  }

  /** Stop future debits on a mandate. */
  async cancelToken(
    creds: RazorpayCredentials,
    customerId: string,
    tokenId: string,
  ): Promise<boolean> {
    if (creds.mode === 'mock') return true;
    if (!customerId || !tokenId) return false;
    await this.call(
      creds,
      'DELETE',
      RAZORPAY_PATHS.customerToken(customerId, tokenId),
    );
    return true;
  }

  async fetchToken(
    creds: RazorpayCredentials,
    customerId: string,
    tokenId: string,
  ): Promise<any | null> {
    if (creds.mode === 'mock') {
      return { id: tokenId, recurring_status: 'confirmed' };
    }
    if (!customerId || !tokenId) return null;
    try {
      return await this.call<any>(
        creds,
        'GET',
        RAZORPAY_PATHS.customerToken(customerId, tokenId),
      );
    } catch {
      return null;
    }
  }

  // ───────────────────────── Webhooks ─────────────────────────

  verifyWebhookSignature(
    rawBody: string,
    signature: string,
    secret: string,
  ): boolean {
    if (!rawBody || !signature || !secret) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (expected.length !== signature.length) return false;
    // Constant-time compare
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  }

  newOAuthState(): string {
    return randomUUID();
  }
}
