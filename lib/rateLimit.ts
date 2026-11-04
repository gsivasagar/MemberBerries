/**
 * Small in-memory fixed-window rate limiter. On serverless hosts each instance keeps its own counters, so this is a
 * best-effort brake against abuse, not a hard guarantee. Use a shared store (Redis, Upstash) for strict limits.
 */
export type RateLimiter = { check: (key: string) => boolean }

export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now): RateLimiter {
    const windows = new Map<string, { start: number, count: number }>()
    return {
        check(key: string): boolean {
            const t = now()
            const current = windows.get(key)
            if (!current || t - current.start >= windowMs) {
                windows.set(key, { start: t, count: 1 })
                if (windows.size > 5000) {                       // keep memory bounded
                    for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k)
                }
                return true
            }
            if (current.count >= limit) return false
            current.count += 1
            return true
        },
    }
}
