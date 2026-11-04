/** Helpers for the URLs users save. Only http(s) links are accepted anywhere in the app. */

const MAX_URL_LENGTH = 2048

/** Parse `input` and return it as a URL only if it is a plain http(s) address; otherwise null. */
export function parseHttpUrl(input: string): URL | null {
    const text = (input ?? '').trim()
    if (!text || text.length > MAX_URL_LENGTH) return null
    let url: URL
    try {
        url = new URL(text)
    } catch {
        return null
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return url
}

export function isValidHttpUrl(input: string): boolean {
    return parseHttpUrl(input) !== null
}

/** The address to put in an href or window.open, or null when it is not a safe http(s) link. */
export function safeHttpUrl(input: string): string | null {
    return parseHttpUrl(input)?.toString() ?? null
}

/** Host name only (for favicons), or null when the URL is not usable. */
export function hostnameOf(input: string): string | null {
    return parseHttpUrl(input)?.hostname ?? null
}
