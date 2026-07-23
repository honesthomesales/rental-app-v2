/**
 * Simple in-memory rate limits for portal probes and payment submissions.
 * Best-effort on serverless (per-instance).
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const MAX_INVALID = 30;
const MAX_CHECKOUT = 10;

function isBlocked(key: string, max: number): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) return false;
  return existing.count >= max;
}

function record(key: string): void {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  existing.count += 1;
}

export function isPortalProbeBlocked(key: string): boolean {
  return isBlocked(`probe:${key}`, MAX_INVALID);
}

export function recordInvalidPortalProbe(key: string): void {
  record(`probe:${key}`);
}

export function isPortalCheckoutBlocked(key: string): boolean {
  return isBlocked(`checkout:${key}`, MAX_CHECKOUT);
}

export function recordPortalCheckout(key: string): void {
  record(`checkout:${key}`);
}
