import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchPreview, PreviewError } from '@/lib/preview'
import { createRateLimiter } from '@/lib/rateLimit'
import { parseHttpUrl } from '@/lib/url'

// Uses Node's DNS resolver for the address checks, so it cannot run on the edge runtime.
export const runtime = 'nodejs'

// Best-effort per-user brake (each serverless instance keeps its own counters).
const limiter = createRateLimiter(30, 60_000)

export async function GET(request: NextRequest) {
    // Only signed-in users may make the server fetch URLs on their behalf.
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }
    if (!limiter.check(user.id)) {
        return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const url = request.nextUrl.searchParams.get('url')
    if (!url) {
        return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }
    if (!parseHttpUrl(url)) {
        return NextResponse.json({ error: 'Only http and https addresses are allowed' }, { status: 400 })
    }

    try {
        const preview = await fetchPreview(url)
        return NextResponse.json(preview, { headers: { 'Cache-Control': 'private, max-age=3600' } })
    } catch (error) {
        if (error instanceof PreviewError) {
            return NextResponse.json({ error: error.message }, { status: error.status })
        }
        console.error('Preview failed unexpectedly:', error)
        return NextResponse.json({ error: 'Failed to build a preview' }, { status: 500 })
    }
}
