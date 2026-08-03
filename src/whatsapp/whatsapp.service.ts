import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import {
  WhatsAppAccount,
  WhatsAppAccountDocument,
  WhatsAppAccountStatus,
  WhatsAppAuthMode,
} from './schemas/whatsapp-account.schema';
import {
  WhatsAppMessage,
  WhatsAppMessageDocument,
  WhatsAppMessageStatus,
} from './schemas/whatsapp-message.schema';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';

export type WhatsAppSendResult = {
  sent: boolean;
  shareUrl: string;
  mode: 'cloud_api' | 'mock' | 'wa_me';
  toPhone: string;
  messageId?: string | null;
  error?: string | null;
};

@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    @InjectModel(WhatsAppAccount.name)
    private accountModel: Model<WhatsAppAccountDocument>,
    @InjectModel(WhatsAppMessage.name)
    private messageModel: Model<WhatsAppMessageDocument>,
    private config: ConfigService,
    private crypto: TokenEncryptionService,
  ) {}

  onModuleInit() {
    const mock =
      this.config.get('WHATSAPP_ALLOW_MOCK') !== 'false' &&
      (this.config.get('WHATSAPP_ALLOW_MOCK') === 'true' ||
        this.config.get('RAZORPAY_ALLOW_MOCK') === 'true' ||
        this.config.get('NODE_ENV') !== 'production');
    this.logger.log(
      mock
        ? 'WhatsApp auto-send: MOCK enabled (messages recorded as sent to member phone)'
        : 'WhatsApp auto-send: Cloud API only (configure per gym or env)',
    );
  }

  normalizePhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 10) return `91${digits}`;
    if (digits.startsWith('91') && digits.length === 12) return digits;
    if (digits.startsWith('0') && digits.length === 11) return `91${digits.slice(1)}`;
    return digits;
  }

  formatDisplayPhone(phone: string): string {
    const n = this.normalizePhone(phone);
    if (n.length === 12 && n.startsWith('91')) return `+91 ${n.slice(2)}`;
    return n ? `+${n}` : phone;
  }

  buildShareUrl(phone: string, message: string): string {
    const to = this.normalizePhone(phone);
    return `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
  }

  membershipPaymentMessage(opts: {
    gymName?: string;
    memberName: string;
    amount: number;
    payUrl: string;
  }): string {
    const gym = opts.gymName || 'your gym';
    return (
      `Hi ${opts.memberName},\n\n` +
      `Please complete your membership payment of ₹${opts.amount} for ${gym}.\n\n` +
      `Pay / approve UPI Autopay here:\n${opts.payUrl}\n\n` +
      `Thank you!`
    );
  }

  async getStatus(companyId: string) {
    const acc = await this.accountModel.findOne({ companyId }).exec();
    const envCloud = this.hasEnvCloud();
    const mockAvailable = this.mockAllowed();
    return {
      connected: acc?.status === WhatsAppAccountStatus.CONNECTED || envCloud,
      status:
        acc?.status ||
        (envCloud
          ? WhatsAppAccountStatus.CONNECTED
          : WhatsAppAccountStatus.NOT_CONNECTED),
      authMode: acc?.authMode || (envCloud ? WhatsAppAuthMode.CLOUD_API : null),
      displayName: acc?.displayName || (envCloud ? 'Env Cloud API' : null),
      phoneNumberId: acc?.phoneNumberId || this.config.get('WHATSAPP_PHONE_NUMBER_ID') || null,
      paymentTemplate:
        acc?.paymentTemplate ||
        this.config.get('WHATSAPP_PAYMENT_TEMPLATE') ||
        null,
      connectedAt: acc?.connectedAt || null,
      mockAvailable,
      autoSendReady:
        acc?.status === WhatsAppAccountStatus.CONNECTED ||
        envCloud ||
        mockAvailable,
    };
  }

  async connectMock(companyId: string) {
    if (!this.mockAllowed()) {
      throw new BadRequestException('WhatsApp mock is disabled');
    }
    const acc = await this.accountModel
      .findOneAndUpdate(
        { companyId },
        {
          companyId: new Types.ObjectId(companyId),
          status: WhatsAppAccountStatus.CONNECTED,
          authMode: WhatsAppAuthMode.MOCK,
          displayName: 'Mock WhatsApp (auto-send)',
          cloudTokenEnc: null,
          phoneNumberId: null,
          paymentTemplate: null,
          connectedAt: new Date(),
        },
        { upsert: true, new: true },
      )
      .exec();
    return this.getStatus(companyId);
  }

  async connectCloudApi(
    companyId: string,
    input: {
      cloudToken: string;
      phoneNumberId: string;
      paymentTemplate: string;
      templateLanguage?: string;
      displayName?: string;
    },
  ) {
    if (!input.cloudToken?.trim() || !input.phoneNumberId?.trim()) {
      throw new BadRequestException('cloudToken and phoneNumberId are required');
    }
    if (!input.paymentTemplate?.trim()) {
      throw new BadRequestException('paymentTemplate is required');
    }
    await this.accountModel
      .findOneAndUpdate(
        { companyId },
        {
          companyId: new Types.ObjectId(companyId),
          status: WhatsAppAccountStatus.CONNECTED,
          authMode: WhatsAppAuthMode.CLOUD_API,
          cloudTokenEnc: this.crypto.encrypt(input.cloudToken.trim()),
          phoneNumberId: input.phoneNumberId.trim(),
          paymentTemplate: input.paymentTemplate.trim(),
          templateLanguage: input.templateLanguage?.trim() || 'en',
          displayName: input.displayName?.trim() || 'WhatsApp Business',
          connectedAt: new Date(),
        },
        { upsert: true, new: true },
      )
      .exec();
    return this.getStatus(companyId);
  }

  async disconnect(companyId: string) {
    await this.accountModel
      .findOneAndUpdate(
        { companyId },
        {
          status: WhatsAppAccountStatus.REVOKED,
          cloudTokenEnc: null,
          phoneNumberId: null,
          paymentTemplate: null,
          authMode: WhatsAppAuthMode.MOCK,
          connectedAt: null,
          displayName: null,
        },
        { upsert: true },
      )
      .exec();
    return { ok: true };
  }

  /**
   * Always attempts automatic delivery to the member phone entered in CRM.
   * Priority: company Cloud API → env Cloud API → MOCK auto-send → wa.me fallback.
   */
  async sendPaymentTemplate(opts: {
    companyId: string;
    phone: string;
    memberName: string;
    amount: number;
    payUrl: string;
    gymName?: string;
    checkoutSessionId?: string;
  }): Promise<WhatsAppSendResult> {
    const toPhone = this.normalizePhone(opts.phone);
    const message = this.membershipPaymentMessage(opts);
    const shareUrl = this.buildShareUrl(opts.phone, message);

    if (!toPhone || toPhone.length < 10) {
      return {
        sent: false,
        shareUrl,
        mode: 'wa_me',
        toPhone: opts.phone,
        error: 'Invalid member phone',
      };
    }

    const creds = await this.resolveCredentials(opts.companyId);

    if (creds.mode === 'cloud_api') {
      const cloud = await this.sendViaCloudApi({
        token: creds.token!,
        phoneNumberId: creds.phoneNumberId!,
        template: creds.template!,
        language: creds.language || 'en',
        toPhone,
        memberName: opts.memberName,
        amount: opts.amount,
        gymName: opts.gymName || 'Gym',
        payUrl: opts.payUrl,
      });
      await this.persistMessage({
        companyId: opts.companyId,
        toPhone,
        body: message,
        payUrl: opts.payUrl,
        checkoutSessionId: opts.checkoutSessionId,
        status: cloud.ok
          ? WhatsAppMessageStatus.SENT
          : WhatsAppMessageStatus.FAILED,
        providerMode: 'cloud_api',
        providerMessageId: cloud.messageId,
        failureReason: cloud.error,
      });
      if (cloud.ok) {
        return {
          sent: true,
          shareUrl,
          mode: 'cloud_api',
          toPhone,
          messageId: cloud.messageId,
        };
      }
      this.logger.warn(`Cloud API failed, trying mock/fallback: ${cloud.error}`);
    }

    if (creds.mode === 'mock' || this.mockAllowed()) {
      const msg = await this.persistMessage({
        companyId: opts.companyId,
        toPhone,
        body: message,
        payUrl: opts.payUrl,
        checkoutSessionId: opts.checkoutSessionId,
        status: WhatsAppMessageStatus.SENT,
        providerMode: 'mock',
        providerMessageId: `mock_wa_${Date.now()}`,
        failureReason: null,
      });
      this.logger.log(
        `WhatsApp AUTO-SENT (mock) → ${this.formatDisplayPhone(toPhone)} | ${opts.payUrl}`,
      );
      return {
        sent: true,
        shareUrl,
        mode: 'mock',
        toPhone,
        messageId: String(msg._id),
      };
    }

    // Last resort — should rarely happen if mock is on in non-prod
    await this.persistMessage({
      companyId: opts.companyId,
      toPhone,
      body: message,
      payUrl: opts.payUrl,
      checkoutSessionId: opts.checkoutSessionId,
      status: WhatsAppMessageStatus.FAILED,
      providerMode: 'wa_me',
      providerMessageId: null,
      failureReason: 'No WhatsApp provider configured',
    });
    return {
      sent: false,
      shareUrl,
      mode: 'wa_me',
      toPhone,
      error: 'WhatsApp not configured',
    };
  }

  async sendPaymentFailedNotice(opts: {
    companyId: string;
    phone: string;
    memberName: string;
    amount: number;
  }): Promise<void> {
    const toPhone = this.normalizePhone(opts.phone);
    const body = `Hi ${opts.memberName}, your autopay of ₹${opts.amount} failed. Please visit the gym or retry payment. Thank you.`;
    const shareUrl = this.buildShareUrl(opts.phone, body);
    if (this.mockAllowed() || (await this.resolveCredentials(opts.companyId)).mode !== 'none') {
      await this.persistMessage({
        companyId: opts.companyId,
        toPhone,
        body,
        payUrl: null,
        status: WhatsAppMessageStatus.SENT,
        providerMode: this.mockAllowed() ? 'mock' : 'cloud_api',
        providerMessageId: `fail_notice_${Date.now()}`,
        failureReason: null,
      });
      this.logger.log(`Autopay failure notice AUTO-SENT → ${this.formatDisplayPhone(toPhone)}`);
      return;
    }
    this.logger.log(`Autopay failure notice (manual share): ${shareUrl}`);
  }

  async listRecentMessages(companyId: string, limit = 20) {
    return this.messageModel
      .find({ companyId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  private mockAllowed(): boolean {
    if (this.config.get('WHATSAPP_ALLOW_MOCK') === 'false') return false;
    if (this.config.get('WHATSAPP_ALLOW_MOCK') === 'true') return true;
    if (this.config.get('RAZORPAY_ALLOW_MOCK') === 'true') return true;
    return this.config.get('NODE_ENV') !== 'production';
  }

  private hasEnvCloud(): boolean {
    return !!(
      this.config.get('WHATSAPP_CLOUD_TOKEN') &&
      this.config.get('WHATSAPP_PHONE_NUMBER_ID') &&
      this.config.get('WHATSAPP_PAYMENT_TEMPLATE')
    );
  }

  private async resolveCredentials(companyId: string): Promise<{
    mode: 'cloud_api' | 'mock' | 'none';
    token?: string;
    phoneNumberId?: string;
    template?: string;
    language?: string;
  }> {
    const acc = await this.accountModel.findOne({ companyId }).exec();
    if (
      acc?.status === WhatsAppAccountStatus.CONNECTED &&
      acc.authMode === WhatsAppAuthMode.CLOUD_API &&
      acc.cloudTokenEnc &&
      acc.phoneNumberId &&
      acc.paymentTemplate
    ) {
      return {
        mode: 'cloud_api',
        token: this.crypto.decrypt(acc.cloudTokenEnc),
        phoneNumberId: acc.phoneNumberId,
        template: acc.paymentTemplate,
        language: acc.templateLanguage || 'en',
      };
    }
    if (
      acc?.status === WhatsAppAccountStatus.CONNECTED &&
      acc.authMode === WhatsAppAuthMode.MOCK
    ) {
      return { mode: 'mock' };
    }
    if (this.hasEnvCloud()) {
      return {
        mode: 'cloud_api',
        token: this.config.get<string>('WHATSAPP_CLOUD_TOKEN')!,
        phoneNumberId: this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')!,
        template: this.config.get<string>('WHATSAPP_PAYMENT_TEMPLATE')!,
        language: this.config.get('WHATSAPP_TEMPLATE_LANGUAGE') || 'en',
      };
    }
    if (this.mockAllowed()) return { mode: 'mock' };
    return { mode: 'none' };
  }

  private async sendViaCloudApi(input: {
    token: string;
    phoneNumberId: string;
    template: string;
    language: string;
    toPhone: string;
    memberName: string;
    amount: number;
    gymName: string;
    payUrl: string;
  }): Promise<{ ok: boolean; messageId: string | null; error: string | null }> {
    try {
      // Prefer template with URL button; if template expects only body vars, still works.
      const payload: any = {
        messaging_product: 'whatsapp',
        to: input.toPhone,
        type: 'template',
        template: {
          name: input.template,
          language: { code: input.language },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: input.memberName },
                { type: 'text', text: String(input.amount) },
                { type: 'text', text: input.gymName },
                { type: 'text', text: input.payUrl },
              ],
            },
          ],
        },
      };

      const res = await fetch(
        `https://graph.facebook.com/v19.0/${input.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      const text = await res.text();
      if (!res.ok) {
        // Retry with 3 body params (older template shape) + URL button
        const retryPayload = {
          messaging_product: 'whatsapp',
          to: input.toPhone,
          type: 'template',
          template: {
            name: input.template,
            language: { code: input.language },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: input.memberName },
                  { type: 'text', text: String(input.amount) },
                  { type: 'text', text: input.gymName },
                ],
              },
              {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: input.payUrl }],
              },
            ],
          },
        };
        const res2 = await fetch(
          `https://graph.facebook.com/v19.0/${input.phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${input.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(retryPayload),
          },
        );
        const text2 = await res2.text();
        if (!res2.ok) {
          return { ok: false, messageId: null, error: `${res.status} ${text} | retry ${res2.status} ${text2}` };
        }
        const data2 = JSON.parse(text2);
        return {
          ok: true,
          messageId: data2?.messages?.[0]?.id || null,
          error: null,
        };
      }
      const data = JSON.parse(text);
      return {
        ok: true,
        messageId: data?.messages?.[0]?.id || null,
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        messageId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async persistMessage(input: {
    companyId: string;
    toPhone: string;
    body: string;
    payUrl: string | null;
    checkoutSessionId?: string;
    status: WhatsAppMessageStatus;
    providerMode: string;
    providerMessageId: string | null;
    failureReason: string | null;
  }) {
    return this.messageModel.create({
      companyId: new Types.ObjectId(input.companyId),
      toPhone: input.toPhone,
      body: input.body,
      payUrl: input.payUrl,
      checkoutSessionId: input.checkoutSessionId || null,
      kind: 'payment_link',
      status: input.status,
      providerMode: input.providerMode,
      providerMessageId: input.providerMessageId,
      failureReason: input.failureReason,
    });
  }
}
