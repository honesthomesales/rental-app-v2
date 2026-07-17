import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validate Twilio webhook X-Twilio-Signature (HMAC-SHA1).
 * Spec: https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(args: {
  authToken: string;
  signature: string | null | undefined;
  url: string;
  params: Record<string, string>;
}): boolean {
  const token = String(args.authToken || "");
  const signature = String(args.signature || "");
  if (!token || !signature) return false;

  const sortedKeys = Object.keys(args.params).sort();
  let data = args.url;
  for (const key of sortedKeys) {
    data += key + args.params[key];
  }

  const expected = createHmac("sha1", token).update(data, "utf8").digest("base64");

  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
