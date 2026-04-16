/**
 * Compute rupees off and final list price from either explicit ₹ discount (preferred)
 * or legacy percent on `amount` (list price before discount).
 */
export function computeMemberDiscount(
  listPrice: number,
  legacyPercent: number | undefined,
  explicitRupees: number | undefined | null,
): {
  rupeesOff: number;
  finalAmount: number;
  /** true when `explicitRupees` was used */
  usedAmountDiscount: boolean;
} {
  const amount = Math.max(0, listPrice);
  if (explicitRupees != null && explicitRupees > 0) {
    const rupeesOff = Math.min(
      Math.round(explicitRupees * 100) / 100,
      amount,
    );
    return {
      rupeesOff,
      finalAmount: Math.round((amount - rupeesOff) * 100) / 100,
      usedAmountDiscount: true,
    };
  }
  const pct = Math.max(0, legacyPercent ?? 0);
  const rupeesOff = Math.round((amount * pct) / 100 * 100) / 100;
  return {
    rupeesOff,
    finalAmount: Math.round((amount - rupeesOff) * 100) / 100,
    usedAmountDiscount: false,
  };
}

/** Total discount in ₹ for analytics — uses stored `discountAmount` when set, else legacy %. */
export function memberDiscountRupeesForAnalytics(member: {
  amount?: number | null;
  discount?: number | null;
  discountAmount?: number | null;
}): number {
  const list = member.amount ?? 0;
  if (member.discountAmount != null && member.discountAmount > 0) {
    return Math.min(member.discountAmount, list);
  }
  const pct = member.discount ?? 0;
  return (list * pct) / 100;
}
