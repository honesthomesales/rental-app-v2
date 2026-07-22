/**
 * Phone normalization helpers for V3 communications.
 * Default country: US (+1).
 */

export function digitsOnly(input: string): string {
  return String(input || "").replace(/\D/g, "");
}

export function isExactE164(input: string | null | undefined): boolean {
  return /^\+[1-9]\d{7,14}$/.test(String(input || ""));
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
    const normalized = `+${digits}`;
    return isExactE164(normalized) ? normalized : null;
  }

  const digits = digitsOnly(raw);
  if (digits.length === 10) {
    return `+${defaultCountryCode}${digits}`;
  }
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) {
    return `+${digits}`;
  }
  return null;
}

export function isUsablePhone(input: string | null | undefined): boolean {
  return normalizeToE164(input) != null;
}

/** tel: href (legacy helper; Call Tenant UI removed). */
export function telHref(input: string | null | undefined): string | null {
  const e164 = normalizeToE164(input);
  if (!e164) return null;
  return `tel:${e164}`;
}

/**
 * sms: href for manual Text Tenant. Opens the device messaging app with
 * optional prefilled body. Does not prove the message was sent.
 */
export function smsHref(
  input: string | null | undefined,
  body?: string | null,
): string | null {
  const e164 = normalizeToE164(input);
  if (!e164) return null;
  const base = `sms:${e164}`;
  if (body == null || !String(body).trim()) return base;
  return `${base}?&body=${encodeURIComponent(String(body))}`;
}
