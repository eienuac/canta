import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => NextResponse.next(),
}))

import { proxy } from '@/proxy'
import { MAINTENANCE_COOKIE, maintenanceDecision } from '@/lib/maintenance'

const TOKEN = 'test-bypass-token-1234567890'
const site = 'https://shop.test'
const req = (path: string, cookie?: string) =>
  new NextRequest(`${site}${path}`, { headers: cookie ? { cookie: `${MAINTENANCE_COOKIE}=${cookie}` } : {} })

describe('maintenance mode', () => {
  beforeEach(() => {
    vi.stubEnv('MAINTENANCE_MODE', 'on')
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', TOKEN)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('is off unless MAINTENANCE_MODE is set', async () => {
    vi.stubEnv('MAINTENANCE_MODE', '')
    const res = await proxy(req('/'))
    expect(res.status).toBe(200)
  })

  it('shows the 503 maintenance page to visitors', async () => {
    const res = await proxy(req('/products'))
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('3600')
    expect(await res.text()).toContain('Kısa bir bakımdayız')
  })

  it('closes storefront APIs (no orders while closed)', async () => {
    for (const path of ['/api/checkout', '/api/cart', '/api/cart/merge', '/api/account/orders']) {
      expect((await proxy(req(path))).status).toBe(503)
    }
  })

  it('keeps payment callbacks/webhooks, cron and the CMS admin reachable', async () => {
    for (const path of ['/api/payments/callback', '/api/payments/webhook', '/api/cron/release-stock', '/admin', '/admin/collections/products']) {
      expect((await proxy(req(path))).status).not.toBe(503)
    }
  })

  it('a wrong token does not open the site', async () => {
    expect((await proxy(req('/?bakim=wrong-token-wrong-token'))).status).toBe(503)
    expect((await proxy(req('/', 'forged-cookie'))).status).toBe(503)
  })

  it('the right token sets a 7-day httpOnly cookie and redirects without the secret', async () => {
    const res = await proxy(req('/products?bakim=' + TOKEN + '&sort=new'))

    expect(res.status).toBe(307)
    const location = res.headers.get('location')!
    expect(location).toBe(`${site}/products?sort=new`)
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain(`${MAINTENANCE_COOKIE}=`)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Max-Age=604800/)
    expect(cookie).not.toContain(TOKEN) // a digest is stored, never the token
  })

  it('the bypass cookie opens pages and storefront APIs', async () => {
    const granted = await proxy(req('/?bakim=' + TOKEN))
    const value = /canta_maintenance_bypass=([^;]+)/.exec(granted.headers.get('set-cookie')!)![1]

    expect((await proxy(req('/', value))).status).toBe(200)
    expect((await proxy(req('/api/checkout', value))).status).not.toBe(503)
  })

  it('a changed token invalidates old cookies', async () => {
    const granted = await proxy(req('/?bakim=' + TOKEN))
    const value = /canta_maintenance_bypass=([^;]+)/.exec(granted.headers.get('set-cookie')!)![1]
    vi.stubEnv('MAINTENANCE_BYPASS_TOKEN', 'another-token-0987654321')

    expect((await proxy(req('/', value))).status).toBe(503)
  })

  it('without a token (or a too short one) nobody can bypass', () => {
    const env = { MAINTENANCE_MODE: 'on', MAINTENANCE_BYPASS_TOKEN: 'short' }
    expect(maintenanceDecision({ pathname: '/', queryToken: 'short', cookie: null }, env)).toEqual({
      action: 'block',
      api: false,
    })
  })
})
