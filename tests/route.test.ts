import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let currentUser: { id: string } | null = { id: 'user-1' }
const fetchPreview = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}))
vi.mock('@/lib/preview', async (orig) => ({ ...(await orig<typeof import('@/lib/preview')>()), fetchPreview: (...a: unknown[]) => fetchPreview(...a) }))

const call = async (url?: string) => {
    const { GET } = await import('@/app/api/preview/route')
    const qs = url === undefined ? '' : `?url=${encodeURIComponent(url)}`
    return GET(new NextRequest(`http://localhost/api/preview${qs}`))
}

describe('GET /api/preview', () => {
    beforeEach(() => {
        currentUser = { id: 'user-1' }
        fetchPreview.mockReset()
    })

    it('requires a signed-in user and never fetches without one', async () => {
        currentUser = null
        const res = await call('https://example.com')
        expect(res.status).toBe(401)
        expect(fetchPreview).not.toHaveBeenCalled()
    })

    it('rejects a missing or non-http(s) url before fetching', async () => {
        expect((await call()).status).toBe(400)
        expect((await call('javascript:alert(1)')).status).toBe(400)
        expect((await call('file:///etc/passwd')).status).toBe(400)
        expect(fetchPreview).not.toHaveBeenCalled()
    })

    it('returns the preview with a private cache header', async () => {
        fetchPreview.mockResolvedValue({ title: 'T', description: 'D', image: 'https://e.com/i.png', url: 'https://e.com' })
        const res = await call('https://e.com')
        expect(res.status).toBe(200)
        expect(res.headers.get('cache-control')).toBe('private, max-age=3600')
        expect(await res.json()).toMatchObject({ title: 'T', image: 'https://e.com/i.png' })
    })

    it('passes through safe error statuses and hides unexpected ones', async () => {
        const { PreviewError } = await import('@/lib/preview')
        fetchPreview.mockRejectedValueOnce(new PreviewError('That address is not allowed', 400))
        const blocked = await call('https://e.com')
        expect(blocked.status).toBe(400)
        expect(await blocked.json()).toEqual({ error: 'That address is not allowed' })

        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        fetchPreview.mockRejectedValueOnce(new Error('secret internal detail'))
        const failed = await call('https://e.com')
        expect(failed.status).toBe(500)
        expect(JSON.stringify(await failed.json())).not.toContain('secret')
        spy.mockRestore()
    })

    it('rate-limits a single user', async () => {
        currentUser = { id: 'busy-user' }
        fetchPreview.mockResolvedValue({ url: 'https://e.com' })
        const codes: number[] = []
        for (let i = 0; i < 32; i++) codes.push((await call('https://e.com')).status)
        expect(codes.slice(0, 30).every(c => c === 200)).toBe(true)
        expect(codes.slice(30)).toEqual([429, 429])
    })
})
