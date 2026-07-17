/**
 * Phone normalization helpers for V3 communications.
 * Default country: US (+1).
 */

export function digitsOnly(input: string): string {
  return String(input || "").replace(/\D/g, "");
}

/**
 * Normalize to E.164 when possible. Returns null if unusable.
 * Accepts 10-digit US, 11-digit leading 1, or already +E.164.
 */
export function normalizeToE164(
  input: string | null | undefined,
  defaultCountryCode = "1",
): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  if (raw.startsWith("+")) {
    const digits = digitsOnly(raw);
    if (digits.length < 10 || digits.length > 15) return null;
    return `+${digits}`;
  }

  const digits = digitsOnly(raw);
  if (digits.length === 10) {
    return `+${defaultCountryCode}${digits}`;
  }
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) {
    return `+${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

export function isUsablePhone(input: string | null | undefined): boolean {
  return normalizeToE164(input) != null;
}

/** tel: href for Call Tenant (uses normalized E.164 when possible). */
export function telHref(input: string | null | undefined): string | null {
  const e164 = normalizeToE164(input);
  if (!e164) return null;
  return `tel:${e164}`;
}
