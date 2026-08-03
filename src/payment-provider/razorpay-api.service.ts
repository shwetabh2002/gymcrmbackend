import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomUUID } from 'crypto';

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
  /** When true, request recurring/mandate-capable payment where API allows */
  enableAutopay?: boolean;
};

export type CreatePaymentLinkResult = {
  id: string;
  shortUrl: string;
  orderId: string | null;
  customerId: string | null;
  qrData: string;
  mock?: boolean;
};

@Injectable()
export class RazorpayApiService {
  private readonly logger = new Logger(RazorpayApiService.name);
  private readonly baseUrl = 'https://api.razorpay.com/v1';

  constructor(private config: ConfigService) {}

  getPartnerClientId() {
    return this.config.get<string>('RAZORPAY_PARTNER_CLIENT_ID') || '';
  }

  getPartnerClientSecret() {
    return this.config.get<string>('RAZORPAY_PARTNER_CLIENT_SECRET') || '';
  }

  getOAuthRedirectUri() {
    return (
      this.config.get<string>('RAZORPAY_PARTNER_REDIRECT_URI') ||
      `${this.config.get('CRM_PUBLIC_URL') || 'http://localhost:3000'}/settings/razorpay/callback`
    );
  }

  isPartnerConfigured() {
    return !!(this.getPartnerClientId() && this.getPartnerClientSecret());
  }

  buildAuthorizeUrl(state: string) {
    const clientId = this.getPartnerClientId();
    const redirect = encodeURIComponent(this.getOAuthRedirectUri());
    const scopes = encodeURIComponent(
      'read_write',
    );
    return `https://auth.razorpay.com/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${redirect}&scope=${scopes}&state=${encodeURIComponent(state)}`;
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
      mode: 'test',
    });
    const res = await fetch('https://auth.razorpay.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`OAuth token exchange failed: ${res.status} ${text}`);
      throw new Error(`Razorpay OAuth failed: ${res.status}`);
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
    const res = await fetch('https://auth.razorpay.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new Error(`Razorpay refresh failed: ${res.status}`);
    }
    return res.json();
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

  async createPaymentLink(
    creds: RazorpayCredentials,
    input: CreatePaymentLinkInput,
  ): Promise<CreatePaymentLinkResult> {
    if (creds.mode === 'mock') {
      const id = `plink_mock_${randomBytes(6).toString('hex')}`;
      const orderId = `order_mock_${randomBytes(6).toString('hex')}`;
      const backend =
        this.config.get('BACKEND_PUBLIC_URL') ||
        `http://localhost:${this.config.get('PORT') || 5000}`;
      const shortUrl = `${backend}/webhooks/razorpay/mock-pay/${id}`;
      return {
        id,
        shortUrl,
        orderId,
        customerId: `cust_mock_${randomBytes(4).toString('hex')}`,
        qrData: shortUrl,
        mock: true,
      };
    }

    const payload: Record<string, unknown> = {
      amount: input.amountPaise,
      currency: input.currency || 'INR',
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
      callback_url: input.callbackUrl,
      callback_method: 'get',
    };

    const res = await fetch(`${this.baseUrl}/payment_links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeader(creds),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`createPaymentLink failed: ${res.status} ${text}`);
      throw new Error(`Razorpay payment link failed: ${res.status}`);
    }

    const data = (await res.json()) as any;
    const shortUrl = data.short_url as string;
    return {
      id: data.id,
      shortUrl,
      orderId: data.order_id || null,
      customerId: data.customer?.id || null,
      qrData: shortUrl,
    };
  }

  /**
   * Recurring charge against a saved UPI Autopay token.
   * Uses create payment with token — mock succeeds immediately.
   */
  async chargeToken(
    creds: RazorpayCredentials,
    input: {
      amountPaise: number;
      tokenId: string;
      customerId?: string;
      receipt: string;
      notes?: Record<string, string>;
    },
  ): Promise<{ paymentId: string; orderId: string; status: string }> {
    if (creds.mode === 'mock') {
      return {
        paymentId: `pay_mock_${randomBytes(6).toString('hex')}`,
        orderId: `order_mock_${randomBytes(6).toString('hex')}`,
        status: 'captured',
      };
    }

    const orderRes = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeader(creds),
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: 'INR',
        payment_capture: true,
        receipt: input.receipt,
        notes: input.notes || {},
      }),
    });
    if (!orderRes.ok) {
      throw new Error(`Razorpay order failed: ${orderRes.status}`);
    }
    const order = (await orderRes.json()) as any;

    const payRes = await fetch(`${this.baseUrl}/payments/create/recurring`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeader(creds),
      },
      body: JSON.stringify({
        email: 'noreply@gym.local',
        contact: '9999999999',
        amount: input.amountPaise,
        currency: 'INR',
        order_id: order.id,
        customer_id: input.customerId,
        token: input.tokenId,
        recurring: '1',
        notes: input.notes || {},
      }),
    });
    if (!payRes.ok) {
      const text = await payRes.text();
      throw new Error(`Razorpay recurring charge failed: ${payRes.status} ${text}`);
    }
    const payment = (await payRes.json()) as any;
    return {
      paymentId: payment.razorpay_payment_id || payment.id,
      orderId: order.id,
      status: payment.status || 'created',
    };
  }

  verifyWebhookSignature(
    rawBody: string,
    signature: string,
    secret: string,
  ): boolean {
    const expected = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    return expected === signature;
  }

  newOAuthState(): string {
    return randomUUID();
  }
}
