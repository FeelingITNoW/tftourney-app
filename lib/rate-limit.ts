// Minimal in-process fixed-window rate limiter. No imports: this module is
// shared between Next.js route handlers/server actions and the standalone
// bot process (bot/index.ts), which compiles bot/ plus whatever it imports
// under its own tsconfig and must not pull in the Supabase/Next code paths
// (see lib/discord/cooldown.ts for the same constraint).
//
// State is per process and resets on deploy or restart. That's acceptable
// here: both the web app and the bot run as a single Railway replica
// (railway.bot.json sets numReplicas: 1), so there's no multi-instance
// fan-out to coordinate across.

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

type Entry = { count: number; resetAt: number };

// Above this many distinct keys, sweep expired entries on the next check so
// memory doesn't grow unbounded from one-off keys (e.g. per-IP limiters).
const SWEEP_THRESHOLD = 10_000;

export function createRateLimiter(opts: { limit: number; windowMs: number }) {
  const { limit, windowMs } = opts;
  let entries = new Map<string, Entry>();

  function sweep(now: number): void {
    if (entries.size <= SWEEP_THRESHOLD) return;
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
  }

  return {
    // Counts this attempt against `key` and reports whether it's allowed.
    check(key: string, now: number = Date.now()): RateLimitResult {
      sweep(now);
      const existing = entries.get(key);
      if (!existing || existing.resetAt <= now) {
        entries.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true };
      }
      if (existing.count >= limit) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
      }
      existing.count += 1;
      return { ok: true };
    },
    // Test-only: clears all tracked keys.
    reset(): void {
      entries = new Map();
    },
  };
}

// Prefers x-real-ip (set by a single trusted reverse proxy, e.g. Railway),
// otherwise the LAST hop of x-forwarded-for -- the entry the proxy itself
// appended, not the first, which an untrusted client can set to anything.
export function clientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor.split(",").map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "unknown";
}
