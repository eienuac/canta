import { createHash, timingSafeEqual } from 'crypto'

/**
 * Maintenance mode: the storefront is closed (503) for everyone except browsers that opened
 * the site once with `?bakim=<MAINTENANCE_BYPASS_TOKEN>`.
 *
 *   MAINTENANCE_MODE=on                  → enable (any of: 1, true, on)
 *   MAINTENANCE_BYPASS_TOKEN=<secret>    → at least 16 characters; without it nobody can bypass
 */
export const MAINTENANCE_QUERY = 'bakim'
export const MAINTENANCE_COOKIE = 'canta_maintenance_bypass'
export const MAINTENANCE_COOKIE_MAX_AGE = 7 * 24 * 60 * 60

/**
 * Always reachable: payment provider callbacks/webhooks (the provider's redirect does not carry
 * our cookie, and a paid order must still be completed), scheduled jobs, CMS sync and the
 * Payload admin, which has its own authentication.
 */
const ALWAYS_OPEN_PREFIXES = [
  '/api/payments/',
  '/api/cron/',
  '/api/cms/',
  '/admin',
]

/** Storefront APIs that are closed together with the pages (no orders, carts, … while closed). */
const STOREFRONT_API_PREFIXES = [
  '/api/account',
  '/api/app-admin',
  '/api/cart',
  '/api/checkout',
  '/api/favorites',
  '/api/newsletter',
  '/api/reviews',
  '/api/search',
  '/api/shipping',
]

type Env = Record<string, string | undefined>

/** `/api/cart` matches `/api/cart` and `/api/cart/merge`, not `/api/cartx`; `/api/cron/` matches its children. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix.endsWith('/')) return pathname.startsWith(prefix)
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function maintenanceEnabled(env: Env = process.env): boolean {
  return ['1', 'true', 'on'].includes((env.MAINTENANCE_MODE ?? '').trim().toLowerCase())
}

function bypassToken(env: Env): string | null {
  const token = env.MAINTENANCE_BYPASS_TOKEN?.trim()
  return token && token.length >= 16 ? token : null
}

const digest = (value: string) => createHash('sha256').update(`maintenance:${value}`).digest('hex')

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export type MaintenanceDecision =
  | { action: 'pass' }
  | { action: 'grant'; cookieValue: string } // valid ?bakim= → set cookie, redirect without it
  | { action: 'block'; api: boolean }

export function maintenanceDecision(
  input: { pathname: string; queryToken: string | null; cookie: string | null },
  env: Env = process.env
): MaintenanceDecision {
  if (!maintenanceEnabled(env)) return { action: 'pass' }

  const { pathname } = input
  if (ALWAYS_OPEN_PREFIXES.some((p) => matchesPrefix(pathname, p))) {
    return { action: 'pass' }
  }

  const token = bypassToken(env)
  if (token && input.queryToken && safeEqual(digest(input.queryToken), digest(token))) {
    return { action: 'grant', cookieValue: digest(token) }
  }
  if (token && input.cookie && safeEqual(input.cookie, digest(token))) {
    return { action: 'pass' }
  }

  if (pathname.startsWith('/api/')) {
    // Only storefront APIs are closed; anything else (Payload REST/GraphQL) keeps its own auth.
    const storefront = STOREFRONT_API_PREFIXES.some((p) => matchesPrefix(pathname, p))
    return storefront ? { action: 'block', api: true } : { action: 'pass' }
  }
  return { action: 'block', api: false }
}

export const MAINTENANCE_HTML = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Bakımdayız</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:Georgia,serif;background:#f7f3ee;color:#3b2a20;text-align:center;padding:24px}
  h1{font-size:2rem;margin:0 0 .75rem}
  p{margin:0;color:#7a6a5d;font-family:system-ui,sans-serif}
</style>
</head>
<body>
<main>
  <h1>Kısa bir bakımdayız</h1>
  <p>Mağazamız kısa süre içinde yeniden açılacak. Anlayışınız için teşekkür ederiz.</p>
</main>
</body>
</html>`
