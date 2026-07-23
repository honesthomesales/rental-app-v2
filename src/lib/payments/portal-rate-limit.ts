/**
 * Simple in-memory rate limit for invalid portal token probes.
 * Best-effort on serverless (per-instance).
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const MAX_INVALID = 30;

export function isPortalProbeBlocked(key: string): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) return false;
  return existing.count >= MAX_INVALID;
}

export function recordInvalidPortalProbe(key: string): void {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  existing.count += 1;
}
