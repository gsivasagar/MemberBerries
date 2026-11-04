import { describe, expect, it } from 'vitest'
import { hostnameOf, isValidHttpUrl, parseHttpUrl, safeHttpUrl } from '@/lib/url'

describe('http(s) URL validation', () => {
    it('accepts normal web addresses', () => {
        expect(isValidHttpUrl('https://example.com')).toBe(true)
        expect(isValidHttpUrl('http://example.com/path?q=1#x')).toBe(true)
        expect(isValidHttpUrl('  https://example.com  ')).toBe(true)
    })

    it.each([
        'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd',
        'ftp://example.com', 'mailto:a@b.c', 'vbscript:x', 'example.com', 'https://', '', '   ',
    ])('rejects %s', (bad) => {
        expect(isValidHttpUrl(bad)).toBe(false)
        expect(safeHttpUrl(bad)).toBeNull()
    })

    it('rejects absurdly long input', () => {
        expect(isValidHttpUrl('https://example.com/' + 'a'.repeat(3000))).toBe(false)
    })

    it('returns a normalised URL and the host name', () => {
        expect(safeHttpUrl('https://Example.com')).toBe('https://example.com/')
        expect(hostnameOf('https://sub.example.com:8443/x')).toBe('sub.example.com')
        expect(hostnameOf('javascript:alert(1)')).toBeNull()
        expect(parseHttpUrl('not a url')).toBeNull()
    })
})
