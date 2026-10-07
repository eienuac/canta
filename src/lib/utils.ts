import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(amount: number, currency = 'TRY') {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) return configured
  // On Vercel, fall back to the project's own production domain instead of localhost.
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (vercelHost) return `https://${vercelHost}`
  return 'http://localhost:3000'
}

/**
 * Accepts only same-origin relative paths for post-login redirects.
 * Rejects `//host`, `/\host` (browsers normalise `\` to `/`), control characters and schemes.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || raw[0] !== '/') return fallback
  if (raw[1] === '/' || raw[1] === '\\') return fallback
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback
  return raw
}

export function absoluteUrl(path: string) {
  const base = getSiteUrl().replace(/\/$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
