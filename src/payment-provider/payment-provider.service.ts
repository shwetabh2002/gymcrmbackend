import {
  BadRequestException,
  ForbiddenException,
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
} from '../config/razorpay.config';
import { PlatformBillingService } from '../platform-billing/platform-billing.service';
import {
  GymSettings,
  GymSettingsDocument,
} from '../gym-settings/schemas/gym-settings.schema';

@Injectable()
export class PaymentProviderService {
  private readonly logger = new Logger(PaymentProviderService.name);

  constructor(
    @InjectModel(PaymentProviderAccount.name)
    private accountModel: Model<PaymentProviderAccountDocument>,
    @InjectModel(OAuthState.name)
    private oauthStateModel: Model<OAuthStateDocument>,
    @InjectModel(GymSettings.name)
    private gymSettingsModel: Model<GymSettingsDocument>,
    private encryption: TokenEncryptionService,
    private razorpay: RazorpayApiService,
    private config: ConfigService,
    private runtime: RuntimeService,
    private billing: PlatformBillingService,
  ) {}

  private async assertRazorpayUnlocked(companyId: string) {
    const doc = await this.gymSettingsModel
      .findOne({ companyId: new Types.ObjectId(companyId) })
      .select('featureRazorpayUnlocked featureAutopayUnlocked')
      .lean()
      .exec();
    if (
      doc?.featureRazorpayUnlocked === true ||
      doc?.featureAutopayUnlocked === true
    ) {
      return;
    }
    if (await this.billing.hasFeature(companyId, 'AUTOPAY')) return;
    throw new ForbiddenException(
      'Razorpay is locked for this gym — ask platform admin to unlock it',
    );
  }

  async getStatus(companyId: string) {
    const acc = await this.accountModel.findOne({ companyId }).exec();
    const partnerConfigured = this.razorpay.isPartnerConfigured();
    const shared = {
      partnerOAuthAvailable: partnerConfigured,
      mockAvailable: false,
      environment: this.runtime.nodeEnv,
    };

    if (!acc) {
      return {
        connected: false,
        status: PaymentProviderAccountStatus.NOT_CONNECTED,
        authMode: null,
        accountName: null,
        razorpayAccountId: null,
        connectedAt: null,
        mandateCapable: false,
        ...shared,
      };
    }
    const connected =
      acc.status === PaymentProviderAccountStatus.CONNECTED &&
      acc.authMode === PaymentProviderAuthMode.OAUTH;
    return {
      connected,
      status: acc.status,
      authMode: acc.authMode,
      accountName: acc.accountName,
      razorpayAccountId: acc.razorpayAccountId,
      connectedAt: acc.connectedAt,
      /** Real UPI Autopay mandates use live Partner OAuth credentials. */
      mandateCapable: connected,
      ...shared,
    };
  }

  async startOAuth(companyId: string, userId: string) {
    await this.assertRazorpayUnlocked(companyId);
    if (!this.razorpay.isPartnerConfigured()) {
      throw new BadRequestException(
        'Razorpay one-click connect is not configured on the platform yet. Contact platform support.',
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

  async discardOAuthState(state?: string) {
    if (!state) return;
    await this.oauthStateModel.deleteOne({ state }).exec().catch(() => null);
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
        webhookSecretEnc: null,
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

  async connectMock(companyId: string, userId: string) {
    throw new BadRequestException(
      'Mock Razorpay is disabled — connect Razorpay via OAuth',
    );
  }

  async disconnect(companyId: string) {
    const acc = await this.accountModel.findOne({ companyId }).exec();
    if (!acc) return { ok: true };
    acc.status = PaymentProviderAccountStatus.REVOKED;
    acc.accessTokenEnc = null;
    acc.refreshTokenEnc = null;
    acc.keyIdEnc = null;
    acc.webhookSecretEnc = null;
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
    if (
      !acc ||
      acc.status !== PaymentProviderAccountStatus.CONNECTED ||
      acc.authMode !== PaymentProviderAuthMode.OAUTH
    ) {
      throw new BadRequestException(
        'Connect Razorpay in Payment Settings before using Online / UPI Autopay',
      );
    }
    return acc;
  }

  async getCredentials(companyId: string): Promise<RazorpayCredentials> {
    const acc = await this.requireConnected(companyId);
    if (!acc.accessTokenEnc) {
      throw new BadRequestException('Razorpay OAuth token missing — reconnect');
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
   * Signing secret to verify an incoming webhook with — owned centrally by the
   * platform via Partner OAuth (`RAZORPAY_WEBHOOK_SECRET`). Gyms never manage
   * webhooks or secrets themselves.
   */
  async resolveWebhookSecrets(_companyId?: string | null): Promise<string[]> {
    const secrets: string[] = [];
    const envSecret = (
      this.config.get<string>('RAZORPAY_WEBHOOK_SECRET') || ''
    ).trim();
    if (envSecret) secrets.push(envSecret);
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
