/**
 * Simple in-memory token-bucket rate limiter per source.
 * Refills at RATE tokens/minute up to CAPACITY.
 */
const RATE = 100;     // tokens added per minute
const CAPACITY = 200; // max burst capacity per source

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(source: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(source);

  if (!bucket) {
    bucket = { tokens: CAPACITY, lastRefillMs: now };
    buckets.set(source, bucket);
  }

  // Refill proportionally to elapsed time
  const elapsedMinutes = (now - bucket.lastRefillMs) / 60_000;
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsedMinutes * RATE);
  bucket.lastRefillMs = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }

  return false;
}
