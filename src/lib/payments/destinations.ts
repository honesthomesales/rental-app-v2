/**
 * Server-only payment destinations and support contacts.
 * Never log returned values. Prefer owner TENANT_* names; keep EXISTING_* aliases.
 */

function firstNonEmpty(
  env: NodeJS.ProcessEnv,
  ...names: string[]
): string | null {
  for (const name of names) {
    const raw = env[name];
    if (raw == null) continue;
    const value = raw
      .replace(/\r/g, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return null;
}

/** Digits-only US phone check (10 or 11 starting with 1). */
export function isValidZelleDestination(value: string | null | undefined): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return true;
  if (digits.length === 11 && digits.startsWith("1")) return true;
  // email destination for Zelle
  if (value.includes("@") && value.includes(".")) return true;
  return false;
}

export function isValidCashAppDestination(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  // Cashtag like $Honesthomesales or bare handle
  if (trimmed.startsWith("$") && trimmed.length >= 2) return true;
  if (/^[A-Za-z0-9_]{2,}$/.test(trimmed)) return true;
  return false;
}

export function formatZelleDestinationForDisplay(value: string): string {
  if (value.includes("@")) return value.trim().toLowerCase();
  const digits = value.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) {
    return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
  }
  return value.trim();
}

export function formatCashAppDestinationForDisplay(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("$")) return trimmed;
  return `$${trimmed}`;
}

export function getCashAppDestination(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = firstNonEmpty(
    env,
    "TENANT_CASH_APP_DESTINATION",
    "EXISTING_CASH_APP_DESTINATION",
  );
  if (!isValidCashAppDestination(raw)) return null;
  return formatCashAppDestinationForDisplay(raw!);
}

export function getZelleDestination(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = firstNonEmpty(
    env,
    "TENANT_ZELLE_DESTINATION",
    "EXISTING_ZELLE_DESTINATION",
  );
  if (!isValidZelleDestination(raw)) return null;
  return formatZelleDestinationForDisplay(raw!);
}

export function getPaymentSupportPhone(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = firstNonEmpty(
    env,
    "TENANT_PAYMENT_SUPPORT_PHONE",
    "TENANT_PORTAL_SUPPORT_PHONE",
  );
  if (!raw) return null;
  return formatZelleDestinationForDisplay(raw);
}

export function getPaymentSupportEmail(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return firstNonEmpty(
    env,
    "TENANT_PAYMENT_SUPPORT_EMAIL",
    "TENANT_PORTAL_SUPPORT_EMAIL",
  );
}

export function hasCashAppDestination(env: NodeJS.ProcessEnv = process.env): boolean {
  return getCashAppDestination(env) != null;
}

export function hasZelleDestination(env: NodeJS.ProcessEnv = process.env): boolean {
  return getZelleDestination(env) != null;
}
