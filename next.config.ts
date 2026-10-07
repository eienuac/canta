import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV !== 'production'

// CSP for the storefront. Next.js hydration relies on inline scripts, so script-src keeps
// 'unsafe-inline' (a nonce would force every page to render dynamically). The remaining
// directives still block framing, <base>/<form> hijacking, plugins and foreign connections.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
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

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.payloadcms.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        ],
      },
      {
        // Payload admin ships its own inline/eval-heavy bundle — leave it out of the strict CSP.
        source: '/((?!admin|api/).*)',
        headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy }],
      },
    ]
  },
}

export default withPayload(nextConfig as any)
