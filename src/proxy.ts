import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import {
  MAINTENANCE_COOKIE,
  MAINTENANCE_COOKIE_MAX_AGE,
  MAINTENANCE_HTML,
  MAINTENANCE_QUERY,
  maintenanceDecision,
} from '@/lib/maintenance'

const isDev = process.env.NODE_ENV !== 'production'

/**
 * Per-request CSP with a nonce: no 'unsafe-inline' for scripts. Next.js reads the nonce from
 * the request's CSP header and stamps it on its own inline/bootstrap scripts, and
 * 'strict-dynamic' lets those trusted scripts load the rest of the bundle.
 * Inline styles stay allowed (React `style=""` attributes cannot carry a nonce) — that is a
 * much smaller risk than inline scripts.
 */
function buildCsp(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://*.payloadcms.com",
    "font-src 'self' data:",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co${isDev ? ' ws://localhost:* http://localhost:*' : ''}`,
    "media-src 'self' https://*.supabase.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}

/** Maintenance mode (MAINTENANCE_MODE / MAINTENANCE_BYPASS_TOKEN, see src/lib/maintenance.ts). */
function maintenanceResponse(request: NextRequest): NextResponse | null {
  const decision = maintenanceDecision({
    pathname: request.nextUrl.pathname,
    queryToken: request.nextUrl.searchParams.get(MAINTENANCE_QUERY),
    cookie: request.cookies.get(MAINTENANCE_COOKIE)?.value ?? null,
  })
  if (decision.action === 'pass') return null

  if (decision.action === 'grant') {
    // Remember this browser, then reload the same page without the secret in the URL.
    const clean = request.nextUrl.clone()
    clean.searchParams.delete(MAINTENANCE_QUERY)
    const response = NextResponse.redirect(clean)
    response.cookies.set(MAINTENANCE_COOKIE, decision.cookieValue, {
      httpOnly: true,
      secure: !isDev,
      sameSite: 'lax',
      path: '/',
      maxAge: MAINTENANCE_COOKIE_MAX_AGE,
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const headers = { 'Retry-After': '3600', 'Cache-Control': 'no-store' }
  if (decision.api) {
    return NextResponse.json({ error: 'Mağaza kısa bir bakımda. Lütfen daha sonra tekrar deneyin.' }, { status: 503, headers })
  }
  return new NextResponse(MAINTENANCE_HTML, {
    status: 503,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const closed = maintenanceResponse(request)
  if (closed) return closed

  // Let Payload admin/API handle its own auth (its bundle needs inline/eval, so no strict CSP)
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/payload')) {
    return NextResponse.next()
  }

  // Payment provider callbacks/webhooks must not go through session refresh
  if (pathname.startsWith('/api/payments/')) {
    return NextResponse.next()
  }

  // JSON APIs don't render HTML — no CSP needed
  if (pathname.startsWith('/api/')) {
    return updateSession(request)
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)
  // Forwarded to the render so Next.js can pick the nonce up
  request.headers.set('x-nonce', nonce)
  request.headers.set('Content-Security-Policy', csp)

  const response = await updateSession(request)
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|media|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
