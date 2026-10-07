import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

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
