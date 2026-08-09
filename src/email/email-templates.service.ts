import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  EmailTemplate,
  EmailTemplateDocument,
} from './schemas/email-template.schema';
import {
  EMAIL_TEMPLATES,
  EMAIL_TYPE_LIST,
  EmailType,
  GYM_EDITABLE_EMAIL_TYPES,
  isEmailType,
  placeholdersFor,
  renderTemplate,
} from '../config/email-templates.config';
import {
  GymSettings,
  GymSettingsDocument,
} from '../gym-settings/schemas/gym-settings.schema';
import { EmailService } from './email.service';
import { CompanyContextService } from '../common/company-context/company-context.service';
import { emailBodyToHtml } from './templates/branded-email.template';

export type ResolvedTemplate = {
  type: EmailType;
  subject: string;
  body: string;
  enabled: boolean;
  /** true when the gym has saved its own copy. */
  customised: boolean;
};

/** Values a caller supplies; gym branding is merged in automatically. */
export type TemplateVars = Record<string, string | number | undefined | null>;

@Injectable()
export class EmailTemplatesService {
  private readonly logger = new Logger(EmailTemplatesService.name);

  constructor(
    @InjectModel(EmailTemplate.name)
    private templateModel: Model<EmailTemplateDocument>,
    @InjectModel(GymSettings.name)
    private settingsModel: Model<GymSettingsDocument>,
    private email: EmailService,
    private companyContext: CompanyContextService,
  ) {}

  // ───────────────────────── Settings screen ─────────────────────────

  /** Every template a gym may edit, with its current state. */
  async listForGym(companyId: string) {
    const rows = await this.templateModel.find({ companyId }).lean().exec();
    const byType = new Map(rows.map((r) => [r.type, r]));

    return GYM_EDITABLE_EMAIL_TYPES.map((type) => {
      const def = EMAIL_TEMPLATES[type];
      const saved = byType.get(type);
      return {
        type,
        label: def.label,
        description: def.description,
        placeholders: placeholdersFor(type),
        subject: saved?.subject ?? def.defaultSubject,
        body: saved?.body ?? def.defaultBody,
        defaultSubject: def.defaultSubject,
        defaultBody: def.defaultBody,
        enabled: saved ? saved.enabled : def.defaultEnabled,
        customised: !!(saved?.subject || saved?.body),
      };
    });
  }

  async upsertForGym(
    companyId: string,
    type: string,
    input: {
      subject?: string | null;
      body?: string | null;
      enabled?: boolean;
    },
    userId?: string,
  ) {
    if (!isEmailType(type)) {
      throw new BadRequestException(`Unknown email type: ${type}`);
    }
    if (!EMAIL_TEMPLATES[type].editableByGym) {
      throw new BadRequestException(
        `${EMAIL_TEMPLATES[type].label} is managed by the platform`,
      );
    }

    const update: Record<string, unknown> = {
      companyId: new Types.ObjectId(companyId),
      type,
    };
    // Empty string means "back to the platform default", not "blank email".
    if (input.subject !== undefined) {
      update.subject = input.subject?.trim() ? input.subject.trim() : null;
    }
    if (input.body !== undefined) {
      update.body = input.body?.trim() ? input.body : null;
    }
    if (input.enabled !== undefined) update.enabled = input.enabled;
    if (userId) update.updatedByUserId = new Types.ObjectId(userId);

    await this.templateModel
      .findOneAndUpdate({ companyId, type }, update, {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true,
      })
      .exec();

    return this.listForGym(companyId);
  }

  /** Drop the override so the platform default applies again. */
  async resetForGym(companyId: string, type: string) {
    if (!isEmailType(type)) {
      throw new BadRequestException(`Unknown email type: ${type}`);
    }
    await this.templateModel.deleteOne({ companyId, type }).exec();
    return this.listForGym(companyId);
  }

  // ───────────────────────── Sending ─────────────────────────

  private async resolve(
    companyId: string | null,
    type: EmailType,
  ): Promise<ResolvedTemplate> {
    const def = EMAIL_TEMPLATES[type];
    if (!companyId) {
      return {
        type,
        subject: def.defaultSubject,
        body: def.defaultBody,
        enabled: def.defaultEnabled,
        customised: false,
      };
    }

    const saved = await this.templateModel
      .findOne({ companyId, type })
      .lean()
      .exec();

    return {
      type,
      subject: saved?.subject ?? def.defaultSubject,
      body: saved?.body ?? def.defaultBody,
      enabled: saved ? saved.enabled : def.defaultEnabled,
      customised: !!(saved?.subject || saved?.body),
    };
  }

  /** Gym-specific values available to every template. */
  private async branding(companyId: string | null) {
    if (!companyId) return null;
    const settings = await this.settingsModel
      .findOne({ companyId })
      .select(
        'gymName logoUrl primaryColor invoiceEmail invoicePhone invoiceAddress websiteUrl',
      )
      .lean()
      .exec();
    if (!settings) return null;
    return settings as any;
  }

  /**
   * Renders and sends one templated email.
   *
   * Skipped — without an error — when the gym switched the type off, when the
   * caller passed `send: false`, or when there is no recipient address. Callers
   * treat email as best-effort; it never blocks the operation that triggered it.
   */
  async sendTemplated(input: {
    companyId: string | null;
    type: EmailType;
    to?: string | null;
    vars: TemplateVars;
    /** Per-call opt-out, e.g. the "Send email" checkbox on the member form. */
    send?: boolean;
  }): Promise<{ sent: boolean; reason?: string }> {
    if (input.send === false) return { sent: false, reason: 'opted_out' };

    const to = (input.to || '').trim();
    if (!to) return { sent: false, reason: 'no_recipient' };

    const template = await this.resolve(input.companyId, input.type);
    if (!template.enabled) {
      return { sent: false, reason: 'disabled_for_gym' };
    }

    const brand = await this.branding(input.companyId);
    const vars: TemplateVars = {
      gymName: brand?.gymName || 'Your gym',
      gymPhone: brand?.invoicePhone || '',
      gymEmail: brand?.invoiceEmail || '',
      ...input.vars,
    };

    const subject = renderTemplate(template.subject, vars);
    const text = renderTemplate(template.body, vars);

    const result = await this.email.send({
      to,
      subject,
      text,
      html: emailBodyToHtml({
        body: text,
        gymName: String(vars.gymName || ''),
        logoUrl: brand?.logoUrl || null,
        primaryColor: brand?.primaryColor || null,
        footer: [brand?.invoicePhone, brand?.invoiceEmail, brand?.websiteUrl]
          .filter(Boolean)
          .join(' · '),
      }),
      // Replies reach the gym, not the platform.
      replyTo: brand?.invoiceEmail || undefined,
      fromName: brand?.gymName || undefined,
    });

    if (!result.ok) {
      this.logger.warn(
        `Email ${input.type} to ${to} failed: ${result.error ?? 'unknown'}`,
      );
      return { sent: false, reason: result.error || 'send_failed' };
    }
    return { sent: true };
  }

  /** Render without sending — powers the settings preview. */
  async preview(companyId: string, type: string, vars: TemplateVars = {}) {
    if (!isEmailType(type)) {
      throw new BadRequestException(`Unknown email type: ${type}`);
    }
    const template = await this.resolve(companyId, type);
    const brand = await this.branding(companyId);
    const country = await this.companyContext.getCountry(companyId);

    // Placeholder values so a gym sees a realistic mail, not `{memberName}`.
    const sample: TemplateVars = {
      gymName: brand?.gymName || 'Your gym',
      gymPhone: brand?.invoicePhone || '+91 90000 00000',
      gymEmail: brand?.invoiceEmail || 'gym@example.com',
      memberName: 'Rahul Sharma',
      memberId: 'GYM-0001',
      planName: 'Monthly Gold',
      amount: `${country.currencySymbol}2,000`,
      startDate: '2026-08-01',
      expiryDate: '2026-09-01',
      paymentDate: '2026-08-01',
      paymentMode: 'Cash',
      invoiceNumber: 'INV-20260801-0001',
      payUrl: 'https://rzp.io/i/example',
      reason: 'Insufficient balance',
      adminName: 'Owner',
      email: 'owner@example.com',
      password: '••••••••',
      loginUrl: 'https://crm.example.com/login',
      ...vars,
    };

    return {
      type,
      subject: renderTemplate(template.subject, sample),
      text: renderTemplate(template.body, sample),
      enabled: template.enabled,
      customised: template.customised,
    };
  }

  /** All types, for docs/debugging. */
  allTypes() {
    return EMAIL_TYPE_LIST.map((type) => ({
      ...EMAIL_TEMPLATES[type],
      placeholders: placeholdersFor(type),
    }));
  }
}
