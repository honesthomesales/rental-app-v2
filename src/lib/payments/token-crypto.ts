import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

function encryptionKey(): Buffer | null {
  const raw = String(process.env.BANK_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  // Accept 32-byte hex or derive from passphrase.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("BANK_TOKEN_ENCRYPTION_KEY_MISSING");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("BANK_TOKEN_ENCRYPTION_KEY_MISSING");
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1") throw new Error("UNSUPPORTED_CIPHER_VERSION");
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
