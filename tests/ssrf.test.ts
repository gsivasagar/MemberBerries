import { describe, expect, it } from 'vitest'
import { assertPublicHttpUrl, isPublicAddress, UrlBlockedError } from '@/lib/ssrf'

describe('isPublicAddress', () => {
    it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '2606:4700:4700::1111'])(
        'allows public address %s', (ip) => expect(isPublicAddress(ip)).toBe(true))

    it.each([
        '127.0.0.1', '127.255.255.255', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1',
        '169.254.169.254', '100.64.0.1', '0.0.0.0', '0.1.2.3', '224.0.0.1', '255.255.255.255', '240.0.0.1', '192.0.2.5',
        '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1',
        '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:169.254.169.254', '64:ff9b::7f00:1',
    ])('blocks non-public address %s', (ip) => expect(isPublicAddress(ip)).toBe(false))

    it('allows an IPv4-mapped public address and rejects garbage', () => {
        expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true)
        expect(isPublicAddress('not-an-ip')).toBe(false)
        expect(isPublicAddress('999.1.1.1')).toBe(false)
        expect(isPublicAddress('')).toBe(false)
    })
})

const publicDns = async () => ['93.184.216.34']

describe('assertPublicHttpUrl', () => {
    it('accepts a public https address', async () => {
        const url = await assertPublicHttpUrl('https://example.com/a', publicDns)
        expect(url.hostname).toBe('example.com')
    })

    it.each([
        'javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', 'gopher://example.com',
        'https://user:pw@example.com', 'http://example.com:22', 'http://example.com:6379', 'https://example.com:3306/x',
    ])('blocks %s', async (bad) => {
        await expect(assertPublicHttpUrl(bad, publicDns)).rejects.toBeInstanceOf(UrlBlockedError)
    })

    it.each([
        'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5:8080/', 'http://192.168.0.1/',
        'http://[::1]/', 'http://[fd00::1]/', 'http://0.0.0.0/', 'http://[::ffff:127.0.0.1]/',
        'http://2130706433/', 'http://0x7f.0.0.1/', 'http://017700000001/',
    ])('blocks private IP literal %s (including decimal, hex and octal tricks)', async (bad) => {
        await expect(assertPublicHttpUrl(bad, publicDns)).rejects.toBeInstanceOf(UrlBlockedError)
    })

    it('blocks a name that resolves to a private address, even if only one answer is private', async () => {
        await expect(assertPublicHttpUrl('http://internal.example/', async () => ['10.0.0.9'])).rejects.toThrow(/not allowed/)
        await expect(assertPublicHttpUrl('http://mixed.example/', async () => ['93.184.216.34', '127.0.0.1'])).rejects.toThrow(/not allowed/)
    })

    it('blocks localhost names via their resolved address', async () => {
        await expect(assertPublicHttpUrl('http://localhost/', async () => ['127.0.0.1', '::1'])).rejects.toBeInstanceOf(UrlBlockedError)
    })

    it('reports unresolvable hosts and empty answers as blocked', async () => {
        await expect(assertPublicHttpUrl('http://nope.invalid/', async () => { throw new Error('ENOTFOUND') })).rejects.toThrow(/could not be found/)
        await expect(assertPublicHttpUrl('http://empty.example/', async () => [])).rejects.toBeInstanceOf(UrlBlockedError)
    })
})

describe('with the real DNS resolver', () => {
    it('blocks localhost without any network access', async () => {
        await expect(assertPublicHttpUrl('http://localhost/')).rejects.toBeInstanceOf(UrlBlockedError)
        await expect(assertPublicHttpUrl('http://localhost:8080/admin')).rejects.toBeInstanceOf(UrlBlockedError)
    })
})
