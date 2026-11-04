import { describe, expect, it, vi } from 'vitest'
import { fetchPreview, PreviewError, type FetchLike } from '@/lib/preview'

const publicDns = async () => ['93.184.216.34']

const html = (head: string) => `<html><head>${head}</head><body>hi</body></html>`
const page = (body: string, type = 'text/html; charset=utf-8', status = 200, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { 'content-type': type, ...headers } })

describe('fetchPreview', () => {
    it('extracts Open Graph data and resolves a relative image', async () => {
        const f = vi.fn<FetchLike>(async () => page(html(
            '<meta property="og:title" content="Hello"><meta property="og:description" content="World">' +
            '<meta property="og:image" content="/img/cover.png">')))
        const p = await fetchPreview('https://example.com/post', { fetch: f, resolve: publicDns })
        expect(p).toEqual({ title: 'Hello', description: 'World', image: 'https://example.com/img/cover.png', url: 'https://example.com/post' })
        expect(f).toHaveBeenCalledOnce()
        expect(f.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
    })

    it('falls back to the <title> tag and drops non-http(s) images', async () => {
        const f = async () => page(html('<title>  Plain   title </title><meta property="og:image" content="javascript:alert(1)">'))
        const p = await fetchPreview('https://example.com', { fetch: f, resolve: publicDns })
        expect(p.title).toBe('Plain title')
        expect(p.image).toBeUndefined()
        const g = async () => page(html('<meta property="og:image" content="data:image/png;base64,AAAA">'))
        expect((await fetchPreview('https://example.com', { fetch: g, resolve: publicDns })).image).toBeUndefined()
    })

    it('returns direct image links without reading them', async () => {
        const p = await fetchPreview('https://example.com/a/photo.png', { fetch: async () => page('', 'image/png'), resolve: publicDns })
        expect(p.image).toBe('https://example.com/a/photo.png')
        expect(p.title).toBe('photo.png')
    })

    it('rejects private targets before making any request', async () => {
        const f = vi.fn()
        for (const bad of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'file:///etc/passwd']) {
            await expect(fetchPreview(bad, { fetch: f, resolve: publicDns })).rejects.toMatchObject({ status: 400 })
        }
        await expect(fetchPreview('http://sneaky.example/', { fetch: f, resolve: async () => ['10.1.1.1'] })).rejects.toMatchObject({ status: 400 })
        expect(f).not.toHaveBeenCalled()
    })

    it('follows a safe redirect', async () => {
        const f = vi.fn()
            .mockResolvedValueOnce(page('', 'text/html', 301, { location: 'https://www.example.com/final' }))
            .mockResolvedValueOnce(page(html('<title>Final</title>')))
        const p = await fetchPreview('http://example.com', { fetch: f, resolve: publicDns })
        expect(p.title).toBe('Final')
        expect(f.mock.calls.map(c => c[0])).toEqual(['http://example.com/', 'https://www.example.com/final'])
    })

    it('blocks a redirect that points at an internal address (the classic bypass)', async () => {
        const f = vi.fn().mockResolvedValue(page('', 'text/html', 302, { location: 'http://169.254.169.254/latest/meta-data/' }))
        await expect(fetchPreview('https://example.com', { fetch: f, resolve: publicDns })).rejects.toMatchObject({ status: 400 })
        expect(f).toHaveBeenCalledOnce()           // the internal address was never requested
    })

    it('blocks a redirect to a hostname that resolves to a private address', async () => {
        const dns = async (h: string) => (h === 'evil.example' ? ['192.168.1.10'] : ['93.184.216.34'])
        const f = vi.fn().mockResolvedValue(page('', 'text/html', 302, { location: 'https://evil.example/' }))
        await expect(fetchPreview('https://example.com', { fetch: f, resolve: dns })).rejects.toMatchObject({ status: 400 })
    })

    it('stops after too many redirects', async () => {
        const f = async () => page('', 'text/html', 302, { location: 'https://example.com/again' })
        await expect(fetchPreview('https://example.com', { fetch: f, resolve: publicDns, maxRedirects: 3 })).rejects.toThrow(/Too many redirects/)
    })

    it('rejects non-web content and upstream errors with clear statuses', async () => {
        await expect(fetchPreview('https://example.com', { fetch: async () => page('{}', 'application/json'), resolve: publicDns })).rejects.toMatchObject({ status: 415 })
        await expect(fetchPreview('https://example.com', { fetch: async () => page('', 'text/html', 500), resolve: publicDns })).rejects.toMatchObject({ status: 502 })
        await expect(fetchPreview('https://example.com', { fetch: async () => { throw new Error('boom') }, resolve: publicDns })).rejects.toMatchObject({ status: 502 })
    })

    it('reads at most maxBytes and still finds tags near the top', async () => {
        const big = html('<title>Top</title>') + 'x'.repeat(5_000_000)
        const p = await fetchPreview('https://example.com', { fetch: async () => page(big), resolve: publicDns, maxBytes: 10_000 })
        expect(p.title).toBe('Top')
    })

    it('does not follow a redirect with no location', async () => {
        await expect(fetchPreview('https://example.com', { fetch: async () => page('', 'text/html', 302), resolve: publicDns })).rejects.toBeInstanceOf(PreviewError)
    })

    it('clips very long titles and descriptions', async () => {
        const f = async () => page(html(`<meta property="og:title" content="${'t'.repeat(900)}"><meta name="description" content="${'d'.repeat(900)}">`))
        const p = await fetchPreview('https://example.com', { fetch: f, resolve: publicDns })
        expect(p.title).toHaveLength(200)
        expect(p.description).toHaveLength(500)
    })
})
