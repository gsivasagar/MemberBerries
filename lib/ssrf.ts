/**
 * Server-side request forgery guard for anything that fetches a user-supplied URL.
 *
 * A URL is allowed only if it is http(s) on a standard web port, has no embedded credentials, and EVERY address
 * its host resolves to is public. Residual risk: the address is checked before the request is made, so a hostile
 * DNS server could answer differently the second time ("DNS rebinding"). Pin the resolved address in the HTTP
 * client if this route ever handles high-value targets.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { parseHttpUrl } from './url'

export class UrlBlockedError extends Error {}

export type Resolver = (hostname: string) => Promise<string[]>

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443'])

/** [network, prefix length] pairs that are not public internet addresses. */
const BLOCKED_V4: Array<[string, number]> = [
    ['0.0.0.0', 8],        // "this" network
    ['10.0.0.0', 8],       // private
    ['100.64.0.0', 10],    // carrier-grade NAT
    ['127.0.0.0', 8],      // loopback
    ['169.254.0.0', 16],   // link-local, cloud metadata
    ['172.16.0.0', 12],    // private
    ['192.0.0.0', 24],     // IETF protocol assignments
    ['192.0.2.0', 24],     // documentation
    ['192.168.0.0', 16],   // private
    ['198.18.0.0', 15],    // benchmarking
    ['198.51.100.0', 24],  // documentation
    ['203.0.113.0', 24],   // documentation
    ['224.0.0.0', 4],      // multicast
    ['240.0.0.0', 4],      // reserved (includes broadcast)
]

function v4ToInt(ip: string): number {
    return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0)
}

function inV4Range(ip: string, [network, bits]: [string, number]): boolean {
    const size = 2 ** (32 - bits)
    const start = Math.floor(v4ToInt(network) / size) * size
    const value = v4ToInt(ip)
    return value >= start && value < start + size
}

/** Expand an IPv6 address into its eight 16-bit groups (handles "::" and a trailing dotted IPv4). */
function expandV6(ip: string): number[] | null {
    let text = ip.toLowerCase().split('%')[0]
    const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/)
    if (dotted) {
        const n = dotted[1].split('.').map(Number)
        if (n.length !== 4 || n.some(x => x > 255)) return null
        text = text.slice(0, -dotted[1].length) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16)
    }
    const halves = text.split('::')
    if (halves.length > 2) return null
    const head = halves[0] ? halves[0].split(':') : []
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
    const missing = 8 - head.length - tail.length
    if (halves.length === 1 ? head.length !== 8 : missing < 0) return null
    const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map(g => parseInt(g || '0', 16))
    return groups.length === 8 && groups.every(g => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null
}

/** True only for addresses on the public internet. Unparseable input is treated as not public. */
export function isPublicAddress(ip: string): boolean {
    const kind = isIP(ip)
    if (kind === 4) return !BLOCKED_V4.some(range => inV4Range(ip, range))
    if (kind === 6) {
        const g = expandV6(ip)
        if (!g) return false
        const [a, b, c, d, e, f, g6, h] = g
        if (g.every(x => x === 0)) return false                              // ::
        if (g.slice(0, 7).every(x => x === 0) && h === 1) return false       // ::1
        // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d): judge the embedded IPv4 address
        const embedded = `${g6 >> 8}.${g6 & 255}.${h >> 8}.${h & 255}`
        if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return isPublicAddress(embedded)
        if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return isPublicAddress(embedded)
        if ((a & 0xfe00) === 0xfc00) return false                            // fc00::/7 unique local
        if ((a & 0xffc0) === 0xfe80) return false                            // fe80::/10 link-local
        if ((a & 0xff00) === 0xff00) return false                            // ff00::/8 multicast
        if (a === 0x2001 && b === 0x0db8) return false                       // documentation
        return true
    }
    return false
}

async function defaultResolver(hostname: string): Promise<string[]> {
    const results = await lookup(hostname, { all: true })
    return results.map(r => r.address)
}

/** Return the parsed URL if it is safe to fetch, otherwise throw UrlBlockedError. */
export async function assertPublicHttpUrl(input: string, resolve: Resolver = defaultResolver): Promise<URL> {
    const url = parseHttpUrl(input)
    if (!url) throw new UrlBlockedError('Only http and https addresses are allowed')
    if (url.username || url.password) throw new UrlBlockedError('Addresses with embedded credentials are not allowed')
    if (!ALLOWED_PORTS.has(url.port)) throw new UrlBlockedError('That port is not allowed')

    const host = url.hostname.replace(/^\[|\]$/g, '')
    let addresses: string[]
    if (isIP(host)) {
        addresses = [host]
    } else {
        try {
            addresses = await resolve(host)
        } catch {
            throw new UrlBlockedError('That host could not be found')
        }
    }
    if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
        throw new UrlBlockedError('That address is not allowed')
    }
    return url
}
