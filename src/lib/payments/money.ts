/** Integer-cent money helpers. Never use floating-point for fee/total math. */

export function dollarsToCents(amount: number | string): number {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) throw new Error("INVALID_AMOUNT");
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(rem).padStart(2, "0")}`;
}

export function assertPositiveCents(cents: number): void {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("AMOUNT_MUST_BE_POSITIVE_CENTS");
  }
}

export type FeePolicyInput = {
  enabled: boolean;
  flatCents: number;
  percentBps: number;
  minimumCents: number;
  maximumCents: number | null;
  payer: "tenant" | "owner";
  grossUp: boolean;
};

/**
 * Calculate fee in cents for a rent amount.
 * Debit/prepaid surcharge must stay disabled via policy.enabled=false for card_debit.
 */
export function calculateFeeCents(
  rentCents: number,
  policy: FeePolicyInput | null,
): { feeCents: number; totalChargedCents: number; rentNetCents: number } {
  assertPositiveCents(rentCents);
  if (!policy || !policy.enabled || policy.payer === "owner") {
    return {
      feeCents: 0,
      totalChargedCents: rentCents,
      rentNetCents: rentCents,
    };
  }

  let fee = policy.flatCents + Math.floor((rentCents * policy.percentBps) / 10000);
  if (fee < policy.minimumCents) fee = policy.minimumCents;
  if (policy.maximumCents != null && fee > policy.maximumCents) {
    fee = policy.maximumCents;
  }
  if (fee < 0) fee = 0;

  if (policy.grossUp && policy.percentBps > 0) {
    // Gross-up so net ≈ rent after percent: total = ceil(rent / (1 - rate))
    const bps = policy.percentBps;
    if (bps >= 10000) throw new Error("INVALID_FEE_PERCENT");
    const gross = Math.ceil((rentCents * 10000) / (10000 - bps)) + policy.flatCents;
    fee = Math.max(0, gross - rentCents);
    if (fee < policy.minimumCents) fee = policy.minimumCents;
    if (policy.maximumCents != null && fee > policy.maximumCents) {
      fee = policy.maximumCents;
    }
    return {
      feeCents: fee,
      totalChargedCents: rentCents + fee,
      rentNetCents: rentCents,
    };
  }

  return {
    feeCents: fee,
    totalChargedCents: rentCents + fee,
    rentNetCents: rentCents,
  };
}
