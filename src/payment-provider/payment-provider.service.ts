import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  PaymentProviderAccount,
  PaymentProviderAccountDocument,
} from './schemas/payment-provider-account.schema';
import { OAuthState, OAuthStateDocument } from './schemas/oauth-state.schema';
import {
  PaymentProvider,
  PaymentProviderAccountStatus,
  PaymentProviderAuthMode,
} from '../common/enums/payment-provider.enum';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import {
  RazorpayApiService,
  RazorpayCredentials,
} from './razorpay-api.service';
import { ConfigService } from '@nestjs/config';
import { RuntimeService } from '../common/runtime/runtime.service';
import {
  RAZORPAY_OAUTH_SCOPES,
  RAZORPAY_OAUTH_STATE_TTL_MS,
  RAZORPAY_TOKEN_REFRESH_LEEWAY_MS,
  RAZORPAY_WEBHOOK_EVENTS,
} from '../config/razorpay.config';

@Injectable()
export class PaymentProviderService {
  private readonly logger = new Logger(PaymentProviderService.name);

  constructor(
    @InjectModel(PaymentProviderAccount.name)
    private accountModel: Model<PaymentProviderAccountDocument>,
    @InjectModel(OAuthState.name)
    private oauthStateModel: Model<OAuthStateDocument>,
    private encryption: TokenEncryptionService,
    private razorpay: RazorpayApiService,
    private config: ConfigService,
    private runtime: RuntimeService,
  ) {}

  async getStatus(companyId: string) {
    const acc = await this.accountModel.findOne({ companyId }).exec();
    const partnerConfigured = this.razorpay.isPartnerConfigured();
    /** Same for every gym — what they paste into the Razorpay dashboard. */
    const shared = {
      partnerOAuthAvailable: partnerConfigured,
      mockAvailable: this.isMockAllowed(),
      environment: this.runtime.nodeEnv,
      webhookUrl: this.runtime.razorpayWebhookUrl(),
      webhookEvents: RAZORPAY_WEBHOOK_EVENTS,
    };

    if (!acc) {
      return {
        connected: false,
        status: PaymentProviderAccountStatus.NOT_CONNECTED,
        authMode: null,
        accountName: null,
        razorpayAccountId: null,
        connectedAt: null,
        webhookSecretSet: false,
        mandateCapable: false,
        ...shared,
      };
    }
    const connected = acc.status === PaymentProviderAccountStatus.CONNECTED;
    return {
      connected,
      status: acc.status,
      authMode: acc.authMode,
      accountName: acc.accountName,
      razorpayAccountId: acc.razorpayAccountId,
      connectedAt: acc.connectedAt,
      /** Gym-specific secret; falls back to the platform env secret. */
      webhookSecretSet: !!acc.webhookSecretEnc,
      /**
       * OAuth gyms are covered by the partner-level webhook, so they never need
       * to touch their own dashboard. API-key gyms must register one themselves.
       */
      webhookOwnedByPlatform: acc.authMode === PaymentProviderAuthMode.OAUTH,
      /** Real UPI Autopay mandates need live credentials, not the mock. */
      mandateCapable:
        connected && acc.authMode !== PaymentProviderAuthMode.MOCK,
      ...shared,
    };
  }

  /**
   * Per-gym webhook secret. Each gym pastes the same URL into its own Razorpay
   * dashboard, so each one gets its own signing secret.
   */
  async setWebhookSecret(companyId: string, secret: string) {
    const trimmed = (secret || '').trim();
    const acc = await this.accountModel.findOne({ companyId }).exec();
    if (!acc) {
      throw new BadRequestException('Connect Razorpay first');
    }
    acc.webhookSecretEnc = trimmed ? this.encryption.encrypt(trimmed) : null;
    await acc.save();
    return this.getStatus(companyId);
  }

  private isMockAllowed() {
    return this.runtime.mockAllowed();
  }

  async startOAuth(companyId: string, userId: string) {
    if (!this.razorpay.isPartnerConfigured()) {
      throw new BadRequestException(
        'Razorpay Partner OAuth is not configured. Set RAZORPAY_PARTNER_CLIENT_ID/SECRET or connect via API keys.',
      );
    }
    const state = this.razorpay.newOAuthState();
    await this.oauthStateModel.create({
      state,
      companyId: new Types.ObjectId(companyId),
      userId: new Types.ObjectId(userId),
      expiresAt: new Date(Date.now() + RAZORPAY_OAUTH_STATE_TTL_MS),
    });
    return { authorizeUrl: this.razorpay.buildAuthorizeUrl(state), state };
  }

  async handleOAuthCallback(code: string, state: string) {
    // Single-use: delete-and-return so a replayed callback cannot connect twice.
    const pending = await this.oauthStateModel
      .findOneAndDelete({ state })
      .exec();
    if (!pending || pending.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
    const tokens = await this.razorpay.exchangeCodeForTokens(code);
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    await this.accountModel.findOneAndUpdate(
      { companyId: pending.companyId },
      {
        companyId: pending.companyId,
        provider: PaymentProvider.RAZORPAY,
        status: PaymentProviderAccountStatus.CONNECTED,
        authMode: PaymentProviderAuthMode.OAUTH,
        razorpayAccountId: tokens.razorpay_account_id || null,
        accountName: tokens.razorpay_account_id || 'Razorpay account',
        accessTokenEnc: this.encryption.encrypt(tokens.access_token),
        refreshTokenEnc: tokens.refresh_token
          ? this.encryption.encrypt(tokens.refresh_token)
          : null,
        keyIdEnc: null,
        expiresAt,
        scopes: [...RAZORPAY_OAUTH_SCOPES],
        connectedAt: new Date(),
        connectedByUserId: pending.userId,
      },
      { upsert: true, returnDocument: 'after' },
    );

    if (!tokens.razorpay_account_id) {
      // Webhooks arriving without our own notes are routed by account id, so a
      // missing one narrows how much we can attribute.
      this.logger.warn(
        `Razorpay OAuth for company ${String(pending.companyId)} returned no razorpay_account_id`,
      );
    }

    return { companyId: String(pending.companyId), ok: true };
  }

  async connectApiKeys(
    companyId: string,
    userId: string,
    keyId: string,
    keySecret: string,
    accountName?: string,
  ) {
    if (!keyId?.trim() || !keySecret?.trim()) {
      throw new BadRequestException('keyId and keySecret are required');
    }
    await this.accountModel.findOneAndUpdate(
      { companyId },
      {
        companyId: new Types.ObjectId(companyId),
        provider: PaymentProvider.RAZORPAY,
        status: PaymentProviderAccountStatus.CONNECTED,
        authMode: PaymentProviderAuthMode.API_KEYS,
        razorpayAccountId: keyId.trim(),
        accountName: accountName?.trim() || keyId.trim(),
        accessTokenEnc: this.encryption.encrypt(keySecret.trim()),
        keyIdEnc: this.encryption.encrypt(keyId.trim()),
        refreshTokenEnc: null,
        expiresAt: null,
        connectedAt: new Date(),
        connectedByUserId: new Types.ObjectId(userId),
      },
      { upsert: true, returnDocument: 'after' },
    );
    return this.getStatus(companyId);
  }

  async connectMock(companyId: string, userId: string) {
    if (!this.isMockAllowed()) {
      throw new BadRequestException('Mock Razorpay is disabled in production');
    }
    await this.accountModel.findOneAndUpdate(
      { companyId },
      {
        companyId: new Types.ObjectId(companyId),
        provider: PaymentProvider.RAZORPAY,
        status: PaymentProviderAccountStatus.CONNECTED,
        authMode: PaymentProviderAuthMode.MOCK,
        razorpayAccountId: `mock_${companyId.slice(-6)}`,
        accountName: 'Mock Razorpay (dev)',
        accessTokenEnc: this.encryption.encrypt('mock'),
        keyIdEnc: null,
        refreshTokenEnc: null,
        expiresAt: null,
        connectedAt: new Date(),
        connectedByUserId: new Types.ObjectId(userId),
      },
      { upsert: true, returnDocument: 'after' },
    );
    return this.getStatus(companyId);
  }

  async disconnect(companyId: string) {
    const acc = await this.accountModel.findOne({ companyId }).exec();
    if (!acc) return { ok: true };
    acc.status = PaymentProviderAccountStatus.REVOKED;
    acc.accessTokenEnc = null;
    acc.refreshTokenEnc = null;
    acc.keyIdEnc = null;
    await acc.save();
    return { ok: true };
  }

  /** Razorpay told us the gym revoked our access — stop pretending we can bill. */
  async markRevoked(companyId: string) {
    await this.accountModel
      .updateOne(
        { companyId },
        {
          status: PaymentProviderAccountStatus.REVOKED,
          accessTokenEnc: null,
          refreshTokenEnc: null,
        },
      )
      .exec();
    return { ok: true };
  }

  async requireConnected(
    companyId: string,
  ): Promise<PaymentProviderAccountDocument> {
    const acc = await this.accountModel.findOne({ companyId }).exec();
    if (!acc || acc.status !== PaymentProviderAccountStatus.CONNECTED) {
      throw new BadRequestException(
        'Connect Razorpay in Gym Settings before using Online / UPI Autopay',
      );
    }
    return acc;
  }

  async getCredentials(companyId: string): Promise<RazorpayCredentials> {
    const acc = await this.requireConnected(companyId);
    if (acc.authMode === PaymentProviderAuthMode.MOCK) {
      return { mode: 'mock' };
    }
    if (acc.authMode === PaymentProviderAuthMode.API_KEYS) {
      if (!acc.keyIdEnc || !acc.accessTokenEnc) {
        throw new BadRequestException('Razorpay API keys incomplete');
      }
      return {
        mode: 'api_keys',
        keyId: this.encryption.decrypt(acc.keyIdEnc),
        keySecret: this.encryption.decrypt(acc.accessTokenEnc),
      };
    }
    if (!acc.accessTokenEnc) {
      throw new BadRequestException('Razorpay OAuth token missing');
    }
    // Refresh if expired
    if (
      acc.expiresAt &&
      acc.expiresAt.getTime() < Date.now() + RAZORPAY_TOKEN_REFRESH_LEEWAY_MS
    ) {
      if (!acc.refreshTokenEnc) {
        acc.status = PaymentProviderAccountStatus.NEEDS_REAUTH;
        await acc.save();
        throw new BadRequestException(
          'Razorpay connection expired — reconnect',
        );
      }
      let refreshed: Awaited<
        ReturnType<typeof this.razorpay.refreshAccessToken>
      >;
      try {
        refreshed = await this.razorpay.refreshAccessToken(
          this.encryption.decrypt(acc.refreshTokenEnc),
        );
      } catch (err) {
        // Flag the account so Settings shows "Reconnect" instead of failing
        // silently on every future charge.
        acc.status = PaymentProviderAccountStatus.NEEDS_REAUTH;
        await acc.save();
        throw err;
      }
      acc.accessTokenEnc = this.encryption.encrypt(refreshed.access_token);
      if (refreshed.refresh_token) {
        acc.refreshTokenEnc = this.encryption.encrypt(refreshed.refresh_token);
      }
      if (refreshed.expires_in) {
        acc.expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
      }
      await acc.save();
    }
    return {
      mode: 'oauth',
      accessToken: this.encryption.decrypt(acc.accessTokenEnc),
    };
  }

  async findCompanyIdByRazorpayAccount(
    razorpayAccountId: string,
  ): Promise<string | null> {
    if (!razorpayAccountId) return null;
    const acc = await this.accountModel
      .findOne({
        razorpayAccountId,
        status: PaymentProviderAccountStatus.CONNECTED,
      })
      .exec();
    return acc ? String(acc.companyId) : null;
  }

  /**
   * Signing secret to verify an incoming webhook with. Prefers the gym's own
   * secret, falls back to the platform-wide env secret. Never falls back to an
   * unrelated secret in production — a missing secret means "reject".
   */
  async resolveWebhookSecrets(companyId?: string | null): Promise<string[]> {
    const secrets: string[] = [];

    if (companyId) {
      const acc = await this.accountModel
        .findOne({ companyId })
        .select('webhookSecretEnc')
        .exec();
      if (acc?.webhookSecretEnc) {
        try {
          secrets.push(this.encryption.decrypt(acc.webhookSecretEnc));
        } catch {
          // corrupt secret — fall through to the env one
        }
      }
    }

    const envSecret = (
      this.config.get<string>('RAZORPAY_WEBHOOK_SECRET') || ''
    ).trim();
    if (envSecret) secrets.push(envSecret);

    if (!secrets.length && !this.runtime.isProduction()) {
      // Local convenience only; production has no implicit secret.
      const fallback = (
        this.config.get<string>('JWT_ACCESS_SECRET') || 'dev-webhook-secret'
      ).trim();
      secrets.push(fallback);
    }

    return secrets;
  }

  /** Resolve company from payment link notes or account id */
  async resolveCompanyFromWebhookPayload(payload: any): Promise<string | null> {
    const entities = [
      payload?.payload?.payment?.entity,
      payload?.payload?.payment_link?.entity,
      payload?.payload?.order?.entity,
      payload?.payload?.invoice?.entity,
      payload?.payload?.token?.entity,
      payload?.payload?.subscription?.entity,
    ];
    for (const entity of entities) {
      const companyId = entity?.notes?.companyId;
      if (companyId) return String(companyId);
    }
    const accountId =
      payload?.account_id ||
      payload?.payload?.payment?.entity?.account_id ||
      null;
    if (accountId) {
      return this.findCompanyIdByRazorpayAccount(String(accountId));
    }
    return null;
  }
}
