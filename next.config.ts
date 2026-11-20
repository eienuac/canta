import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

// Only this project's public Storage bucket may be fetched by the image optimizer. A wildcard
// (`**.supabase.co`) would let anyone route images from their own project through our server.
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname || null
  } catch {
    return null
  }
})()

// NOTE: the Content-Security-Policy header is generated per request (with a nonce) in
// src/proxy.ts. Static security headers live here.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: false,
    remotePatterns: [
      ...(supabaseHost
        ? [{ protocol: 'https' as const, hostname: supabaseHost, pathname: '/storage/v1/object/public/**' }]
        : []),
      ...(process.env.NODE_ENV === 'production' ? [] : [{ protocol: 'http' as const, hostname: 'localhost' }]),
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
    ]
  },
}

export default withPayload(nextConfig)
