import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Company,
  CompanyDocument,
} from '../../companies/schemas/company.schema';
import {
  CountryConfig,
  DEFAULT_COUNTRY_CODE,
  getCountry,
} from '../../config/countries.config';
import { MINUTE_MS } from '../../config/time.constants';

/** Country lookups are read on nearly every money/message path — cache them. */
const CACHE_TTL_MS = 5 * MINUTE_MS;

type CacheEntry = { country: CountryConfig; at: number };

/**
 * Resolves a company's locale facts — currency and phone dial code — so nothing
 * downstream has to assume India.
 *
 * Adding a country to `countries.config.ts` is enough to make money formatting
 * and phone normalisation correct for gyms in that market.
 */
@Injectable()
export class CompanyContextService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectModel(Company.name) private companyModel: Model<CompanyDocument>,
  ) {}

  async getCountry(companyId?: string | null): Promise<CountryConfig> {
    if (!companyId) return getCountry(DEFAULT_COUNTRY_CODE);

    const key = String(companyId);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.country;
    }

    const company = await this.companyModel
      .findById(key)
      .select('countryCode')
      .lean()
      .exec();
    const country = getCountry((company as any)?.countryCode);
    this.cache.set(key, { country, at: Date.now() });
    return country;
  }

  /** Call after a company's country changes so stale formatting cannot persist. */
  invalidate(companyId: string) {
    this.cache.delete(String(companyId));
  }

  /** "₹2,000" in the gym's own currency and locale. */
  async formatMoney(
    companyId: string | null | undefined,
    amount: number,
  ): Promise<string> {
    const country = await this.getCountry(companyId);
    return formatMoneyIn(country, amount);
  }

  /** Digits-only international form, e.g. 919876543210. */
  async normalizePhone(
    companyId: string | null | undefined,
    phone: string,
  ): Promise<string> {
    const country = await this.getCountry(companyId);
    return normalizePhoneIn(country, phone);
  }

  /** Human display form, e.g. "+91 9876543210". */
  async formatPhone(
    companyId: string | null | undefined,
    phone: string,
  ): Promise<string> {
    const country = await this.getCountry(companyId);
    return formatPhoneIn(country, phone);
  }
}

// ── Pure helpers: usable wherever the country is already known ──

export function formatMoneyIn(country: CountryConfig, amount: number): string {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(country.locale, {
      style: 'currency',
      currency: country.currency,
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value);
  } catch {
    // Unknown locale/currency in Intl data — never break a message over it.
    return `${country.currencySymbol}${value}`;
  }
}

/** Dial code without the leading '+', e.g. '91'. */
export function dialDigits(country: CountryConfig): string {
  return (country.phoneDialCode || '').replace(/\D/g, '');
}

/**
 * Turns whatever the front desk typed into a digits-only international number,
 * using the gym's country as the assumed origin.
 */
export function normalizePhoneIn(
  country: CountryConfig,
  phone: string,
): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';

  const dial = dialDigits(country);
  if (!dial) return digits;

  // An explicit '+' means the caller already gave a country code — a member
  // roaming on a foreign number must not get the gym's dial code stapled on.
  if ((phone || '').trim().startsWith('+')) return digits;

  // Already carries this country's dial code.
  if (digits.startsWith(dial) && digits.length > dial.length) return digits;

  // Trunk prefix, e.g. 09876543210 → 919876543210.
  const local = digits.startsWith('0') ? digits.slice(1) : digits;
  return `${dial}${local}`;
}

export function formatPhoneIn(country: CountryConfig, phone: string): string {
  const normalized = normalizePhoneIn(country, phone);
  if (!normalized) return phone;
  const dial = dialDigits(country);
  if (dial && normalized.startsWith(dial)) {
    return `+${dial} ${normalized.slice(dial.length)}`;
  }
  return `+${normalized}`;
}
