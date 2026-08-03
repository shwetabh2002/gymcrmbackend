import { Injectable } from '@nestjs/common';
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
  DEFAULT_INVOICE_DISPLAY,
  isInvoiceLayout,
  isInvoiceStampAlign,
} from '../config/invoice.config';
import {
  getCountry,
  normalizeCountryCode,
} from '../config/countries.config';
import {
  DEFAULT_INVOICE_TAX_MODE,
  DEFAULT_INVOICE_TAX_PERCENTAGE,
  isInvoiceTaxMode,
} from '../invoices/tax.util';

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
      autopayEnabled: doc.autopayEnabled === true,
      countryCode: country.code,
      countryName: country.name,
      currency: country.currency,
      currencySymbol: country.currencySymbol,
      locale: country.locale,
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
      .select('autopayEnabled')
      .lean()
      .exec();
    return doc?.autopayEnabled === true;
  }

  async update(companyId: string, dto: UpdateGymSettingsDto) {
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
    if (dto.autopayEnabled !== undefined) {
      update.autopayEnabled = dto.autopayEnabled;
    }

    const doc = await this.settingsModel
      .findOneAndUpdate({ companyId: cid }, update, {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
      })
      .exec();

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
      await this.companyModel
        .findByIdAndUpdate(cid, {
          countryCode: normalizeCountryCode(dto.countryCode),
        })
        .exec();
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
