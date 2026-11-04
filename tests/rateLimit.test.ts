import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '@/lib/rateLimit'

describe('rate limiter', () => {
    it('allows up to the limit then blocks within the window', () => {
        const rl = createRateLimiter(3, 1000, () => 0)
        expect([rl.check('a'), rl.check('a'), rl.check('a'), rl.check('a')]).toEqual([true, true, true, false])
    })

    it('tracks keys separately and resets after the window', () => {
        let t = 0
        const rl = createRateLimiter(1, 1000, () => t)
        expect(rl.check('a')).toBe(true)
        expect(rl.check('b')).toBe(true)
        expect(rl.check('a')).toBe(false)
        t = 1000
        expect(rl.check('a')).toBe(true)
    })
})
