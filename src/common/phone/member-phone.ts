import { BadRequestException } from '@nestjs/common';

export const DEFAULT_MEMBER_COUNTRY_CODE = '+91';

/** Normalize to `+` + 1–4 digits. Default +91. */
export function normalizeCountryCode(raw?: string | null): string {
  const trimmed =
    (raw ?? DEFAULT_MEMBER_COUNTRY_CODE).trim() || DEFAULT_MEMBER_COUNTRY_CODE;
  const withPlus = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  const digits = withPlus.slice(1).replace(/\D/g, '');
  if (!digits || digits.length > 4) {
    throw new BadRequestException(
      'Country code must be like +91 (1–4 digits after +)',
    );
  }
  return `+${digits}`;
}

/**
 * Store only the local 10-digit number.
 * Strips a matching dial code / leading 0 if the front desk pasted a full number.
 */
export function normalizeLocalPhone(
  raw: string,
  countryCode: string = DEFAULT_MEMBER_COUNTRY_CODE,
): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (!digits) {
    throw new BadRequestException('Contact number is required');
  }

  const dial = countryCode.replace(/\D/g, '');
  if (dial && digits.startsWith(dial) && digits.length === dial.length + 10) {
    digits = digits.slice(dial.length);
  } else if (digits.startsWith('0') && digits.length === 11) {
    digits = digits.slice(1);
  }

  if (!/^\d{10}$/.test(digits)) {
    throw new BadRequestException(
      'Contact number must be exactly 10 digits',
    );
  }
  return digits;
}

/** Digits for WhatsApp / SMS: country dial + local. */
export function toInternationalDigits(
  countryCode: string | null | undefined,
  localPhone: string | null | undefined,
): string {
  const dial = (countryCode || DEFAULT_MEMBER_COUNTRY_CODE).replace(/\D/g, '');
  const local = (localPhone || '').replace(/\D/g, '');
  if (!local) return '';
  if (dial && local.startsWith(dial)) return local;
  return `${dial}${local}`;
}
