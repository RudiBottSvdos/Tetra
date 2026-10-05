// Einfacher In-Memory-Fixed-Window-Limiter (Single-Instance-Deployment).
export interface RateLimiter {
  hit: (key: string, now?: number) => { allowed: boolean, retryAfter: number }
  reset: () => void
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const buckets = new Map<string, { count: number, resetAt: number }>()
  return {
    hit(key, now = Date.now()) {
      if (buckets.size > 10_000) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
      }
      let b = buckets.get(key)
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + windowMs }
        buckets.set(key, b)
      }
      b.count++
      return {
        allowed: b.count <= limit,
        retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000))
      }
    },
    reset: () => buckets.clear()
  }
}

export const authLimiter = createRateLimiter(10, 60_000)
