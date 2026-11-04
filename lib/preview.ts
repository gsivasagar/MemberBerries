/** Fetch Open Graph link-preview data for a user-supplied URL, safely (see lib/ssrf.ts). */
import * as cheerio from 'cheerio'
import { assertPublicHttpUrl, UrlBlockedError, type Resolver } from './ssrf'
import { parseHttpUrl } from './url'

export type Preview = { title?: string, description?: string, image?: string, url: string }

export class PreviewError extends Error {
    constructor(message: string, public status: number) {
        super(message)
    }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export type PreviewOptions = {
    fetch?: FetchLike
    resolve?: Resolver
    /** Overall time budget for the request, including redirects. */
    timeoutMs?: number
    /** At most this many bytes of the page are read; Open Graph tags live in the first part. */
    maxBytes?: number
    maxRedirects?: number
}

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; MemberBerriesPreview/1.0)',
    'Accept': 'text/html,application/xhtml+xml;q=0.9,image/*;q=0.8',
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
    if (!res.body) return ''
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (total < maxBytes) {
        const { done, value } = await reader.read()
        if (done || !value) break
        chunks.push(value)
        total += value.byteLength
    }
    await reader.cancel().catch(() => undefined)
    const merged = new Uint8Array(Math.min(total, maxBytes))
    let offset = 0
    for (const c of chunks) {
        const part = c.subarray(0, merged.length - offset)
        merged.set(part, offset)
        offset += part.length
        if (offset >= merged.length) break
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(merged)
}

function clip(text: string | undefined, max: number): string | undefined {
    const t = text?.replace(/\s+/g, ' ').trim()
    return t ? t.slice(0, max) : undefined
}

export async function fetchPreview(input: string, options: PreviewOptions = {}): Promise<Preview> {
    const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init))
    const maxBytes = options.maxBytes ?? 1_000_000
    const maxRedirects = options.maxRedirects ?? 3
    const deadline = Date.now() + (options.timeoutMs ?? 8000)

    let current = input
    for (let hop = 0; hop <= maxRedirects; hop++) {
        let url: URL
        try {
            url = await assertPublicHttpUrl(current, options.resolve)   // checked again at every redirect hop
        } catch (e) {
            if (e instanceof UrlBlockedError) throw new PreviewError(e.message, 400)
            throw e
        }

        let res: Response
        try {
            res = await doFetch(url.toString(), {
                headers: HEADERS,
                redirect: 'manual',
                signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
            })
        } catch {
            throw new PreviewError('Could not reach that address', 502)
        }

        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location')
            if (!location) throw new PreviewError('Bad redirect from that address', 502)
            current = new URL(location, url).toString()
            continue
        }
        if (!res.ok) throw new PreviewError('That address returned an error', 502)

        const type = (res.headers.get('content-type') ?? '').toLowerCase()
        if (type.startsWith('image/')) {
            return { title: clip(url.pathname.split('/').pop() || 'Image', 200), description: 'Direct image link', image: url.toString(), url: input }
        }
        if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) {
            throw new PreviewError('That address is not a web page', 415)
        }

        const $ = cheerio.load(await readLimited(res, maxBytes))
        const meta = (prop: string) => $(`meta[property="${prop}"]`).attr('content') || $(`meta[name="${prop}"]`).attr('content')
        const rawImage = meta('og:image') || meta('twitter:image') || meta('twitter:image:src')
            || $('link[rel="image_src"]').attr('href') || $('link[rel="apple-touch-icon"]').attr('href') || $('link[rel="icon"]').attr('href')

        let image: string | undefined
        if (rawImage) {
            try {
                image = parseHttpUrl(new URL(rawImage, url).toString())?.toString()   // never hand back a non-http(s) link
            } catch {
                image = undefined
            }
        }
        return {
            title: clip(meta('og:title') || meta('twitter:title') || $('title').first().text(), 200),
            description: clip(meta('og:description') || meta('twitter:description') || meta('description'), 500),
            image,
            url: input,
        }
    }
    throw new PreviewError('Too many redirects', 502)
}
