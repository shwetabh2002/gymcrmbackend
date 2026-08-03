/**
 * GST / tax breakdown for invoices.
 * - excluded: price is pre-tax → tax added on top
 * - included: price already has tax → extract tax from total
 */
export const INVOICE_TAX_MODES = ['excluded', 'included'] as const;
export type InvoiceTaxMode = (typeof INVOICE_TAX_MODES)[number];

export const DEFAULT_INVOICE_TAX_PERCENTAGE = 0;
export const DEFAULT_INVOICE_TAX_MODE: InvoiceTaxMode = 'excluded';

export function isInvoiceTaxMode(v: unknown): v is InvoiceTaxMode {
  return (
    typeof v === 'string' &&
    (INVOICE_TAX_MODES as readonly string[]).includes(v)
  );
}

export type TaxBreakdown = {
  /** Taxable value (before GST) */
  subtotal: number;
  taxPercentage: number;
  taxAmount: number;
  /** Amount customer pays / invoice total */
  totalAmount: number;
  taxMode: InvoiceTaxMode;
};

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * @param priceConfigured Plan / payment amount as configured in the system
 * @param taxPercentage GST rate e.g. 18
 * @param taxMode included | excluded
 */
export function computeTaxBreakdown(
  priceConfigured: number,
  taxPercentage: number,
  taxMode: InvoiceTaxMode = 'excluded',
): TaxBreakdown {
  const price = Math.max(0, Number(priceConfigured) || 0);
  const rate = Math.max(0, Number(taxPercentage) || 0);

  if (rate <= 0 || price <= 0) {
    return {
      subtotal: roundMoney(price),
      taxPercentage: rate,
      taxAmount: 0,
      totalAmount: roundMoney(price),
      taxMode,
    };
  }

  if (taxMode === 'included') {
    // total = price; tax = price * r/(100+r); subtotal = total - tax
    const totalAmount = roundMoney(price);
    const taxAmount = roundMoney((price * rate) / (100 + rate));
    const subtotal = roundMoney(totalAmount - taxAmount);
    return {
      subtotal,
      taxPercentage: rate,
      taxAmount,
      totalAmount,
      taxMode,
    };
  }

  // excluded: tax on top
  const subtotal = roundMoney(price);
  const taxAmount = roundMoney((subtotal * rate) / 100);
  const totalAmount = roundMoney(subtotal + taxAmount);
  return {
    subtotal,
    taxPercentage: rate,
    taxAmount,
    totalAmount,
    taxMode,
  };
}
