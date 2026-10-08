import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  GymSettings,
  GymSettingsDocument,
} from './schemas/gym-settings.schema';
import { UpdateGymSettingsDto } from './dto/update-gym-settings.dto';
import { StorageService, AssetFolder } from '../storage/storage.service';
import { Company, CompanyDocument } from '../companies/schemas/company.schema';
import {
  DEFAULT_SAC_CODE,
  DEFAULT_INVOICE_DISPLAY,
  isInvoiceLayout,
  isInvoiceStampAlign,
} from '../config/invoice.config';
import { getCountry, normalizeCountryCode } from '../config/countries.config';
import { CompanyContextService } from '../common/company-context/company-context.service';
import {
  DEFAULT_INVOICE_TAX_MODE,
  DEFAULT_INVOICE_TAX_PERCENTAGE,
  isInvoiceTaxMode,
} from '../invoices/tax.util';
import { Role } from '../common/enums/role.enum';
import {
  ActivityLogsService,
  ActivityActor,
} from '../activity-logs/activity-logs.service';
import { PlatformBillingService } from '../platform-billing/platform-billing.service';

type BrandAssetKind = 'logo' | 'favicon' | 'stamp';

const FOLDER_BY_KIND: Record<BrandAssetKind, AssetFolder> = {
  logo: 'logos',
  favicon: 'favicons',
  stamp: 'stamps',
};

@Injectable()
export class GymSettingsService {
  constructor(
    @InjectModel(GymSettings.name)
    private settingsModel: Model<GymSettingsDocument>,
    @InjectModel(Company.name)
    private companyModel: Model<CompanyDocument>,
    private storageService: StorageService,
    private companyContext: CompanyContextService,
    private activityLogs: ActivityLogsService,
    private billing: PlatformBillingService,
  ) {}

  private async toClient(doc: any) {
    const upload = this.storageService.getLimits();
    const layout = isInvoiceLayout(doc.invoiceLayout)
      ? doc.invoiceLayout
      : DEFAULT_INVOICE_DISPLAY.layout;
    const company = await this.companyModel
      .findById(doc.companyId)
      .lean()
      .exec();
    const country = getCountry((company as any)?.countryCode);
    return {
      _id: String(doc._id),
      companyId: String(doc.companyId),
      memberIdPrefix: doc.memberIdPrefix,
      gymName: doc.gymName ?? null,
      logoUrl: doc.logoUrl ?? null,
      faviconUrl: doc.faviconUrl ?? null,
      stampUrl: doc.stampUrl ?? null,
      primaryColor: doc.primaryColor || '#E23D2B',
      invoiceAddress: doc.invoiceAddress ?? null,
      invoiceEmail: doc.invoiceEmail ?? null,
      invoicePhone: doc.invoicePhone ?? null,
      invoiceGstin: doc.invoiceGstin ?? null,
      invoiceFooter: doc.invoiceFooter ?? null,
      websiteUrl: doc.websiteUrl ?? null,
      invoiceLayout: layout,
      invoiceShowLogo: doc.invoiceShowLogo !== false,
      invoiceShowStamp: doc.invoiceShowStamp !== false,
      invoiceShowGstin: doc.invoiceShowGstin !== false,
      invoiceShowAddress: doc.invoiceShowAddress !== false,
      invoiceShowContact: doc.invoiceShowContact !== false,
      invoiceStampAlign: isInvoiceStampAlign(doc.invoiceStampAlign)
        ? doc.invoiceStampAlign
        : DEFAULT_INVOICE_DISPLAY.stampAlign,
      invoiceTaxPercentage:
        typeof doc.invoiceTaxPercentage === 'number'
          ? doc.invoiceTaxPercentage
          : DEFAULT_INVOICE_TAX_PERCENTAGE,
      invoiceTaxMode: isInvoiceTaxMode(doc.invoiceTaxMode)
        ? doc.invoiceTaxMode
        : DEFAULT_INVOICE_TAX_MODE,
      invoiceSacCode: doc.invoiceSacCode ?? DEFAULT_SAC_CODE,
      invoicePlaceOfSupply: doc.invoicePlaceOfSupply ?? null,
      invoiceTaxBreakup: doc.invoiceTaxBreakup || 'split',
      invoiceShowAmountInWords: doc.invoiceShowAmountInWords !== false,
      invoiceTerms: doc.invoiceTerms ?? null,
      autopayEnabled: doc.autopayEnabled === true,
      autopayMethod: doc.autopayMethod || 'upi',
      autopayMandateMultiplier:
        typeof doc.autopayMandateMultiplier === 'number'
          ? doc.autopayMandateMultiplier
          : 2,
      autopayMandateValidityMonths:
        typeof doc.autopayMandateValidityMonths === 'number'
          ? doc.autopayMandateValidityMonths
          : 60,
      featureAutopayUnlocked: doc.featureAutopayUnlocked === true,
      featureRazorpayUnlocked: doc.featureRazorpayUnlocked === true,
      featureWhatsappUnlocked: doc.featureWhatsappUnlocked === true,
      featureEmailTemplatesUnlocked: doc.featureEmailTemplatesUnlocked === true,
      featureActivityLogsUnlocked: doc.featureActivityLogsUnlocked === true,
      activityLogsEnabled: doc.activityLogsEnabled === true,
      activityLogRetentionDays:
        typeof doc.activityLogRetentionDays === 'number'
          ? doc.activityLogRetentionDays
          : 30,
      countryCode: country.code,
      countryName: country.name,
      currency: country.currency,
      currencySymbol: country.currencySymbol,
      locale: country.locale,
      /** Gym admins cannot change; SUPER_ADMIN can via PATCH /companies/:id/country */
      countryLocked: (company as any)?.countryLocked !== false,
      upload,
      updatedAt: doc.updatedAt,
      createdAt: doc.createdAt,
    };
  }

  async get(companyId: string) {
    const cid = new Types.ObjectId(companyId);
    let doc = await this.settingsModel.findOne({ companyId: cid }).exec();
    if (!doc) {
      const company = await this.companyModel.findById(cid).exec();
      doc = await this.settingsModel.create({
        companyId: cid,
        memberIdPrefix: company?.memberIdPrefix || 'GYM',
        gymName: company?.name || null,
        primaryColor: '#E23D2B',
        autopayEnabled: false,
      });
    }
    return this.toClient(doc);
  }

  /** Fast boolean for workers / checkout — defaults OFF. */
  async isAutopayEnabled(companyId: string): Promise<boolean> {
    const cid = new Types.ObjectId(companyId);
    const doc = await this.settingsModel
      .findOne({ companyId: cid })
      .select('autopayEnabled featureAutopayUnlocked')
      .lean()
      .exec();
    return (
      doc?.featureAutopayUnlocked === true && doc?.autopayEnabled === true
    );
  }

  /**
   * Platform feature lock — unlocked per gym by SUPER_ADMIN or included in plan.
   * Razorpay: unlock flag OR Autopay (plan/unlock), since Autopay needs Razorpay.
   */
  async assertFeatureUnlocked(
    companyId: string,
    feature:
      | 'autopay'
      | 'razorpay'
      | 'whatsapp'
      | 'emailTemplates',
  ): Promise<void> {
    if (feature === 'autopay') {
      if (await this.billing.hasFeature(companyId, 'AUTOPAY')) return;
      throw new ForbiddenException(
        'Autopay is locked for this gym — ask platform admin to unlock it',
      );
    }
    if (feature === 'whatsapp') {
      if (await this.billing.hasFeature(companyId, 'WHATSAPP_CLOUD')) return;
      throw new ForbiddenException(
        'WhatsApp is locked for this gym — ask platform admin to unlock it',
      );
    }
    if (feature === 'emailTemplates') {
      if (await this.billing.hasFeature(companyId, 'EMAIL_TEMPLATES')) return;
      throw new ForbiddenException(
        'Email templates are locked for this gym — ask platform admin to unlock them',
      );
    }
    // razorpay
    const cid = new Types.ObjectId(companyId);
    const doc = await this.settingsModel
      .findOne({ companyId: cid })
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

  async update(
    companyId: string,
    dto: UpdateGymSettingsDto,
    actorRole?: string,
    actor?: ActivityActor,
  ) {
    const cid = new Types.ObjectId(companyId);
    const update: Record<string, unknown> = { companyId: cid };

    if (dto.memberIdPrefix !== undefined) {
      update.memberIdPrefix = dto.memberIdPrefix.trim().toUpperCase();
    }
    if (dto.gymName !== undefined) {
      update.gymName = dto.gymName?.trim() || null;
    }
    if (dto.primaryColor !== undefined) {
      update.primaryColor = dto.primaryColor;
    }
    if (dto.invoiceAddress !== undefined) {
      update.invoiceAddress = dto.invoiceAddress?.trim() || null;
    }
    if (dto.invoiceEmail !== undefined) {
      update.invoiceEmail = dto.invoiceEmail?.trim() || null;
    }
    if (dto.invoicePhone !== undefined) {
      update.invoicePhone = dto.invoicePhone?.trim() || null;
    }
    if (dto.invoiceGstin !== undefined) {
      update.invoiceGstin = dto.invoiceGstin?.trim() || null;
    }
    if (dto.invoiceFooter !== undefined) {
      update.invoiceFooter = dto.invoiceFooter?.trim() || null;
    }
    if (dto.websiteUrl !== undefined) {
      update.websiteUrl = dto.websiteUrl?.trim() || null;
    }
    if (dto.logoUrl !== undefined) {
      update.logoUrl = dto.logoUrl?.trim() || null;
    }
    if (dto.faviconUrl !== undefined) {
      update.faviconUrl = dto.faviconUrl?.trim() || null;
    }
    if (dto.stampUrl !== undefined) {
      update.stampUrl = dto.stampUrl?.trim() || null;
    }
    if (dto.invoiceLayout !== undefined && isInvoiceLayout(dto.invoiceLayout)) {
      update.invoiceLayout = dto.invoiceLayout;
    }
    if (dto.invoiceShowLogo !== undefined) {
      update.invoiceShowLogo = dto.invoiceShowLogo;
    }
    if (dto.invoiceShowStamp !== undefined) {
      update.invoiceShowStamp = dto.invoiceShowStamp;
    }
    if (dto.invoiceShowGstin !== undefined) {
      update.invoiceShowGstin = dto.invoiceShowGstin;
    }
    if (dto.invoiceShowAddress !== undefined) {
      update.invoiceShowAddress = dto.invoiceShowAddress;
    }
    if (dto.invoiceShowContact !== undefined) {
      update.invoiceShowContact = dto.invoiceShowContact;
    }
    if (
      dto.invoiceStampAlign !== undefined &&
      isInvoiceStampAlign(dto.invoiceStampAlign)
    ) {
      update.invoiceStampAlign = dto.invoiceStampAlign;
    }
    if (dto.invoiceTaxPercentage !== undefined) {
      update.invoiceTaxPercentage = dto.invoiceTaxPercentage;
    }
    if (
      dto.invoiceTaxMode !== undefined &&
      isInvoiceTaxMode(dto.invoiceTaxMode)
    ) {
      update.invoiceTaxMode = dto.invoiceTaxMode;
    }
    if (dto.invoiceSacCode !== undefined) {
      update.invoiceSacCode = dto.invoiceSacCode?.trim() || null;
    }
    if (dto.invoicePlaceOfSupply !== undefined) {
      update.invoicePlaceOfSupply = dto.invoicePlaceOfSupply?.trim() || null;
    }
    if (dto.invoiceTaxBreakup !== undefined) {
      update.invoiceTaxBreakup = dto.invoiceTaxBreakup;
    }
    if (dto.invoiceShowAmountInWords !== undefined) {
      update.invoiceShowAmountInWords = dto.invoiceShowAmountInWords;
    }
    if (dto.invoiceTerms !== undefined) {
      update.invoiceTerms = dto.invoiceTerms?.trim() || null;
    }
    const unlockKeys = [
      'featureAutopayUnlocked',
      'featureRazorpayUnlocked',
      'featureWhatsappUnlocked',
      'featureEmailTemplatesUnlocked',
      'featureActivityLogsUnlocked',
    ] as const;
    const wantsUnlockChange = unlockKeys.some((k) => dto[k] !== undefined);
    if (wantsUnlockChange && actorRole !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only SUPER_ADMIN can unlock payment features for a gym',
      );
    }
    for (const k of unlockKeys) {
      if (dto[k] !== undefined) update[k] = dto[k];
    }
    // Autopay needs Razorpay — unlocking Autopay unlocks Razorpay too
    if (dto.featureAutopayUnlocked === true) {
      update.featureRazorpayUnlocked = true;
    }
    if (dto.activityLogRetentionDays !== undefined) {
      if (actorRole !== Role.SUPER_ADMIN) {
        throw new ForbiddenException(
          'Only SUPER_ADMIN can set activity log retention',
        );
      }
      update.activityLogRetentionDays = dto.activityLogRetentionDays;
    }
    if (dto.activityLogsEnabled !== undefined) {
      if (dto.activityLogsEnabled === true) {
        const access = await this.activityLogs.getAccess(companyId);
        if (!access.globallyEnabled) {
          throw new ForbiddenException(
            'Activity logs are disabled on the server (ACTIVITY_LOGS_ENABLED)',
          );
        }
        // Post-dto entitlement — don't treat a same-request lock as still entitled.
        const unlockedAfter =
          dto.featureActivityLogsUnlocked !== undefined
            ? dto.featureActivityLogsUnlocked === true
            : access.featureUnlocked;
        const entitled = unlockedAfter || access.planIncludes;
        if (!entitled) {
          throw new ForbiddenException(
            "Activity log is not on this gym's plan and is not unlocked — cannot turn ON",
          );
        }
      }
      update.activityLogsEnabled = dto.activityLogsEnabled;
    }
    // Locking Activity log also turns the gym switch OFF (mirror Autopay).
    if (dto.featureActivityLogsUnlocked === false) {
      update.activityLogsEnabled = false;
    }

    // Resolve whether Autopay module will be unlocked after this write
    const existing = await this.settingsModel
      .findOne({ companyId: cid })
      .select(
        'featureAutopayUnlocked autopayEnabled',
      )
      .lean()
      .exec();
    const autopayUnlockedAfter =
      dto.featureAutopayUnlocked !== undefined
        ? dto.featureAutopayUnlocked === true
        : existing?.featureAutopayUnlocked === true;

    if (dto.autopayEnabled !== undefined) {
      if (dto.autopayEnabled === true && !autopayUnlockedAfter) {
        throw new ForbiddenException(
          'Autopay is locked for this gym — ask platform admin to unlock it',
        );
      }
      update.autopayEnabled = dto.autopayEnabled;
    }
    // Locking Autopay also turns the gym toggle OFF
    if (dto.featureAutopayUnlocked === false) {
      update.autopayEnabled = false;
    }
    if (dto.autopayMethod !== undefined) {
      update.autopayMethod = dto.autopayMethod;
    }
    if (dto.autopayMandateMultiplier !== undefined) {
      update.autopayMandateMultiplier = dto.autopayMandateMultiplier;
    }
    if (dto.autopayMandateValidityMonths !== undefined) {
      update.autopayMandateValidityMonths = dto.autopayMandateValidityMonths;
    }

    const doc = await this.settingsModel
      .findOneAndUpdate({ companyId: cid }, update, {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
      })
      .exec();

    // Invalidate after write so concurrent getAccess cannot re-cache stale flags.
    if (
      wantsUnlockChange ||
      dto.activityLogRetentionDays !== undefined ||
      dto.activityLogsEnabled !== undefined ||
      dto.featureActivityLogsUnlocked !== undefined
    ) {
      this.activityLogs.invalidateAccessCache(companyId);
    }

    if (wantsUnlockChange && actor) {
      const changed: Record<string, unknown> = {};
      for (const k of unlockKeys) {
        if (dto[k] !== undefined) changed[k] = dto[k] === true;
      }
      if (dto.activityLogRetentionDays !== undefined) {
        changed.activityLogRetentionDays = dto.activityLogRetentionDays;
      }
      if (dto.activityLogsEnabled !== undefined) {
        changed.activityLogsEnabled = update.activityLogsEnabled === true;
      }
      await this.activityLogs.log({
        companyId,
        actor,
        action: 'FEATURE_UNLOCKS_UPDATED',
        entityType: 'gym_settings',
        entityId: companyId,
        summary: `Feature unlocks updated: ${Object.entries(changed)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`,
        metadata: changed,
      });
    }

    if (dto.gymName !== undefined && dto.gymName.trim()) {
      await this.companyModel
        .findByIdAndUpdate(cid, { name: dto.gymName.trim() })
        .exec();
    }
    if (dto.memberIdPrefix !== undefined) {
      await this.companyModel
        .findByIdAndUpdate(cid, {
          memberIdPrefix: dto.memberIdPrefix.trim().toUpperCase(),
        })
        .exec();
    }
    if (dto.countryCode !== undefined) {
      if (actorRole !== Role.SUPER_ADMIN) {
        throw new ForbiddenException(
          'Country and currency are locked for this gym. Contact platform support to change them.',
        );
      }
      await this.companyModel
        .findByIdAndUpdate(cid, {
          countryCode: normalizeCountryCode(dto.countryCode),
          countryLocked: true,
        })
        .exec();
      this.companyContext.invalidate(companyId);
    }

    return this.toClient(doc);
  }

  async uploadBrandAsset(
    companyId: string,
    file: Express.Multer.File,
    kind: BrandAssetKind = 'logo',
  ) {
    const valid = this.storageService.assertValidImageFile(file);
    const uploaded = await this.storageService.uploadCompanyAsset({
      companyId,
      folder: FOLDER_BY_KIND[kind],
      buffer: valid.buffer,
      mimeType: valid.mimetype,
      originalName: valid.originalname,
    });

    const patch: UpdateGymSettingsDto =
      kind === 'favicon'
        ? { faviconUrl: uploaded.url }
        : kind === 'stamp'
          ? { stampUrl: uploaded.url }
          : { logoUrl: uploaded.url };

    return this.update(companyId, patch);
  }

  /** @deprecated use uploadBrandAsset */
  async uploadLogo(
    companyId: string,
    file: Express.Multer.File,
    kind: BrandAssetKind = 'logo',
  ) {
    return this.uploadBrandAsset(companyId, file, kind);
  }
}
