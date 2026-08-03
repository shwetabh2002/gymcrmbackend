import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  PaymentProviderAccount,
  PaymentProviderAccountDocument,
} from './schemas/payment-provider-account.schema';
import {
  PaymentProvider,
  PaymentProviderAccountStatus,
  PaymentProviderAuthMode,
} from '../common/enums/payment-provider.enum';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { RazorpayApiService, RazorpayCredentials } from './razorpay-api.service';
import { ConfigService } from '@nestjs/config';

/** In-memory OAuth state → companyId (short-lived) */
const oauthStates = new Map<string, { companyId: string; userId: string; at: number }>();

@Injectable()
export class PaymentProviderService {
  constructor(
    @InjectModel(PaymentProviderAccount.name)
    private accountModel: Model<PaymentProviderAccountDocument>,
    private encryption: TokenEncryptionService,
    private razorpay: RazorpayApiService,
    private config: ConfigService,
  ) {}

  async getStatus(companyId: string) {
    const acc = await this.accountModel.findOne({ companyId }).exec();
    const partnerConfigured = this.razorpay.isPartnerConfigured();
    if (!acc) {
      return {
        connected: false,
        status: PaymentProviderAccountStatus.NOT_CONNECTED,
        authMode: null,
        accountName: null,
        razorpayAccountId: null,
        connectedAt: null,
        partnerOAuthAvailable: partnerConfigured,
        mockAvailable: this.isMockAllowed(),
      };
    }
    return {
      connected: acc.status === PaymentProviderAccountStatus.CONNECTED,
      status: acc.status,
      authMode: acc.authMode,
      accountName: acc.accountName,
      razorpayAccountId: acc.razorpayAccountId,
      connectedAt: acc.connectedAt,
      partnerOAuthAvailable: partnerConfigured,
      mockAvailable: this.isMockAllowed(),
    };
  }

  private isMockAllowed() {
    return (
      this.config.get('RAZORPAY_ALLOW_MOCK') === 'true' ||
      this.config.get('NODE_ENV') !== 'production'
    );
  }

  async startOAuth(companyId: string, userId: string) {
    if (!this.razorpay.isPartnerConfigured()) {
      throw new BadRequestException(
        'Razorpay Partner OAuth is not configured. Set RAZORPAY_PARTNER_CLIENT_ID/SECRET or connect via API keys / Mock.',
      );
    }
    const state = this.razorpay.newOAuthState();
    oauthStates.set(state, { companyId, userId, at: Date.now() });
    return { authorizeUrl: this.razorpay.buildAuthorizeUrl(state), state };
  }

  async handleOAuthCallback(code: string, state: string) {
    const pending = oauthStates.get(state);
    oauthStates.delete(state);
    if (!pending || Date.now() - pending.at > 15 * 60 * 1000) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
    const tokens = await this.razorpay.exchangeCodeForTokens(code);
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    await this.accountModel.findOneAndUpdate(
      { companyId: pending.companyId },
      {
        companyId: new Types.ObjectId(pending.companyId),
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
        scopes: ['read_write'],
        connectedAt: new Date(),
        connectedByUserId: new Types.ObjectId(pending.userId),
      },
      { upsert: true, returnDocument: 'after' },
    );

    return { companyId: pending.companyId, ok: true };
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

  async requireConnected(companyId: string): Promise<PaymentProviderAccountDocument> {
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
    if (acc.expiresAt && acc.expiresAt.getTime() < Date.now() + 60_000) {
      if (!acc.refreshTokenEnc) {
        acc.status = PaymentProviderAccountStatus.NEEDS_REAUTH;
        await acc.save();
        throw new BadRequestException('Razorpay connection expired — reconnect');
      }
      const refreshed = await this.razorpay.refreshAccessToken(
        this.encryption.decrypt(acc.refreshTokenEnc),
      );
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

  getWebhookSecret(companyId?: string): string {
    return (
      this.config.get<string>('RAZORPAY_WEBHOOK_SECRET') ||
      this.config.get<string>('JWT_ACCESS_SECRET') ||
      'dev-webhook-secret'
    );
  }

  /** Resolve company from payment link notes or account id */
  async resolveCompanyFromWebhookPayload(payload: any): Promise<string | null> {
    const notes =
      payload?.payload?.payment?.entity?.notes ||
      payload?.payload?.payment_link?.entity?.notes ||
      payload?.payload?.order?.entity?.notes ||
      {};
    if (notes.companyId) return String(notes.companyId);

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
