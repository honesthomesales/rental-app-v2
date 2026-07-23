import { createHash, randomBytes, timingSafeEqual } from "crypto";

export function hashPortalToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generatePortalToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashPortalToken(raw) };
}

export function generateIdempotencyKey(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

export function generateReceiptNumber(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `HHS-R-${day}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Stable short reference like HHS-1047 from tenant uuid. */
export function derivePaymentReference(tenantId: string): string {
  const digest = createHash("sha256").update(tenantId).digest();
  const n = digest.readUInt32BE(0) % 9000;
  return `HHS-${1000 + n}`;
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
