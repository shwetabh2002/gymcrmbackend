/**
 * Supported launch countries — add a row here to open a new market.
 * company.countryCode references these codes.
 */
export type CountryConfig = {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  currency: string; // ISO 4217
  currencySymbol: string;
  locale: string; // BCP 47 for dates/numbers
  phoneDialCode: string;
};

export const COUNTRIES: CountryConfig[] = [
  {
    code: 'IN',
    name: 'India',
    currency: 'INR',
    currencySymbol: '₹',
    locale: 'en-IN',
    phoneDialCode: '+91',
  },
  // {
  //   code: 'AE',
  //   name: 'United Arab Emirates',
  //   currency: 'AED',
  //   currencySymbol: 'AED',
  //   locale: 'en-AE',
  //   phoneDialCode: '+971',
  // },
  // {
  //   code: 'US',
  //   name: 'United States',
  //   currency: 'USD',
  //   currencySymbol: '$',
  //   locale: 'en-US',
  //   phoneDialCode: '+1',
  // },
  // {
  //   code: 'GB',
  //   name: 'United Kingdom',
  //   currency: 'GBP',
  //   currencySymbol: '£',
  //   locale: 'en-GB',
  //   phoneDialCode: '+44',
  // },
  // {
  //   code: 'SG',
  //   name: 'Singapore',
  //   currency: 'SGD',
  //   currencySymbol: 'S$',
  //   locale: 'en-SG',
  //   phoneDialCode: '+65',
  // },
  // {
  //   code: 'AU',
  //   name: 'Australia',
  //   currency: 'AUD',
  //   currencySymbol: 'A$',
  //   locale: 'en-AU',
  //   phoneDialCode: '+61',
  // },
];

export const DEFAULT_COUNTRY_CODE = 'IN';

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));

export function isCountryCode(v: unknown): v is string {
  return typeof v === 'string' && byCode.has(v.toUpperCase());
}

export function getCountry(code?: string | null): CountryConfig {
  const key = (code || DEFAULT_COUNTRY_CODE).toUpperCase();
  return byCode.get(key) || byCode.get(DEFAULT_COUNTRY_CODE)!;
}

export function normalizeCountryCode(code?: string | null): string {
  if (code && isCountryCode(code)) return code.toUpperCase();
  return DEFAULT_COUNTRY_CODE;
}
