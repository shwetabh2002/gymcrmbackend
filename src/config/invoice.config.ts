/**
 * Invoice / PDF document options — change layouts & defaults here (not env).
 */
export const INVOICE_LAYOUTS = ['classic', 'modern', 'minimal'] as const;
export type InvoiceLayout = (typeof INVOICE_LAYOUTS)[number];

export const DEFAULT_INVOICE_LAYOUT: InvoiceLayout = 'classic';

export const INVOICE_STAMP_ALIGNS = ['left', 'center', 'right'] as const;
export type InvoiceStampAlign = (typeof INVOICE_STAMP_ALIGNS)[number];

export const DEFAULT_INVOICE_STAMP_ALIGN: InvoiceStampAlign = 'right';

/** Per-company toggles — all optional assets; invoice still generates without them */
export type InvoiceDisplayOptions = {
  layout: InvoiceLayout;
  showLogo: boolean;
  showStamp: boolean;
  showGstin: boolean;
  showAddress: boolean;
  showContact: boolean;
  stampAlign: InvoiceStampAlign;
};

export const DEFAULT_INVOICE_DISPLAY: InvoiceDisplayOptions = {
  layout: DEFAULT_INVOICE_LAYOUT,
  showLogo: true,
  showStamp: true,
  showGstin: true,
  showAddress: true,
  showContact: true,
  stampAlign: DEFAULT_INVOICE_STAMP_ALIGN,
};

export function isInvoiceLayout(v: unknown): v is InvoiceLayout {
  return (
    typeof v === 'string' &&
    (INVOICE_LAYOUTS as readonly string[]).includes(v)
  );
}

export function isInvoiceStampAlign(v: unknown): v is InvoiceStampAlign {
  return (
    typeof v === 'string' &&
    (INVOICE_STAMP_ALIGNS as readonly string[]).includes(v)
  );
}
