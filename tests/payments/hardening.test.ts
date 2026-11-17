/**
 * M3 (no non-atomic stock fallback), L1 (expiring order-access token),
 * L3 (rate-limited payment callback/webhook), L6 (no internal error leakage).
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { seedPendingOrder, stockRow } from '../helpers/orders'
import {
  callbackGetRequest,
  fetchMock,
  harness,
  iyzicoSuccess,
  location,
  setupPaymentHarness,
  webhookRequest,
} from '../helpers/payment-harness'

const auth = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }))
const cartState = vi.hoisted(() => ({ cart: null as unknown as Record<string, unknown> }))

vi.mock('@/lib/supabase/admin', () => import('../helpers/mocks/supabase-admin'))
vi.mock('@/lib/payload', () => import('../helpers/mocks/payload'))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: auth.user } }) } }),
}))
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  // next/headers is unavailable outside a Next request; routes under test that use it get a fixed IP.
  clientIp: async () => '203.0.113.50',
}))
vi.mock('@/services/cart', () => ({
  assertCartAccess: async () => true,
  getCartWithProducts: async () => structuredClone(cartState.cart),
}))
vi.mock('@/services/coupons', () => ({
  validateCoupon: async () => ({ valid: false, error: 'Geçersiz veya kullanılamayan kupon kodu' }),
}))

import { GET as CALLBACK } from '@/app/(frontend)/api/payments/callback/route'
import { POST as WEBHOOK } from '@/app/(frontend)/api/payments/webhook/route'
import { POST as CHECKOUT } from '@/app/(frontend)/api/checkout/route'
import { POST as RETURNS } from '@/app/(frontend)/api/account/returns/route'
import { commitStock, releaseStock, reserveStock } from '@/services/inventory/sync'
import { ORDER_ACCESS_TTL_MS, signOrderAccess, verifyOrderAccess } from '@/lib/order-token'

setupPaymentHarness()

const fromIp = (req: Request, ip: string) => {
  req.headers.set('x-real-ip', ip)
  return req
}

describe('M3: stock RPC failures never fall back to non-atomic updates', () => {
  it.each([
    ['reserveStock', () => reserveStock('S1', 1, 'k-reserve')],
    ['commitStock', () => commitStock('S1', 1, randomUUID(), 'k-commit')],
    ['releaseStock', () => releaseStock('S1', 1, 'k-release')],
  ])('%s throws and writes nothing when the RPC fails', async (_name, call) => {
    harness.db.tables.inventory.push({ sku: 'S1', quantity: 1, reserved_quantity: 1 })
    harness.db.state.rpcError = true

    await expect(call()).rejects.toThrow(/_inventory failed for S1/)

    expect(stockRow(harness.db, 'S1')).toMatchObject({ quantity: 1, reserved_quantity: 1 })
    expect(harness.db.tables.inventory_ledger).toHaveLength(0)
  })

  it('parallel reservations cannot oversell while the RPC is unavailable', async () => {
    harness.db.tables.inventory.push({ sku: 'S1', quantity: 1, reserved_quantity: 0 })
    harness.db.state.rpcError = true

    const results = await Promise.allSettled([1, 2, 3].map((i) => reserveStock('S1', 1, `k-${i}`)))

    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(stockRow(harness.db, 'S1').reserved_quantity).toBe(0)
  })
})

describe('L1: order-access token', () => {
  const orderId = randomUUID()
  const now = Date.UTC(2026, 10, 17, 12, 0, 0)

  it('is valid for the order it was issued for', () => {
    expect(verifyOrderAccess(orderId, signOrderAccess(orderId, now), now)).toBe(true)
  })

  it('expires after the TTL', () => {
    const token = signOrderAccess(orderId, now)
    expect(verifyOrderAccess(orderId, token, now + ORDER_ACCESS_TTL_MS - 1)).toBe(true)
    expect(verifyOrderAccess(orderId, token, now + ORDER_ACCESS_TTL_MS + 1)).toBe(false)
  })

  it('rejects another order, a tampered MAC, an extended expiry and the old format', () => {
    const token = signOrderAccess(orderId, now)
    const [exp, mac] = token.split('.')
    expect(verifyOrderAccess(randomUUID(), token, now)).toBe(false)
    expect(verifyOrderAccess(orderId, `${exp}.${'0'.repeat(32)}`, now)).toBe(false)
    expect(verifyOrderAccess(orderId, `${Number(exp) + 3_600_000}.${mac}`, now)).toBe(false)
    expect(verifyOrderAccess(orderId, `${now + 10 * ORDER_ACCESS_TTL_MS}.${mac}`, now)).toBe(false)
    expect(verifyOrderAccess(orderId, mac, now)).toBe(false) // pre-expiry token format
  })

  it('the success redirect carries a token that verifies', async () => {
    const o = seedPendingOrder(harness.db, { token: 'tok-1' })
    harness.iyzico = iyzicoSuccess('1000.0')

    const res = await CALLBACK(callbackGetRequest('tok-1'))

    const t = new URL(location(res)).searchParams.get('t')
    expect(verifyOrderAccess(o.id, t)).toBe(true)
  })
})

describe('L3: payment endpoints are rate limited per IP', () => {
  it('callback: the 31st request in a minute is refused without calling iyzico', async () => {
    harness.iyzico = () => ({ status: 'failure', errorCode: '5021' })
    seedPendingOrder(harness.db, { token: 'tok-1' })

    for (let i = 0; i < 30; i++) {
      const res = await CALLBACK(fromIp(callbackGetRequest('tok-1'), '198.51.100.7'))
      expect(location(res)).not.toContain('rate_limited')
    }
    const callsBefore = fetchMock.mock.calls.length
    const blocked = await CALLBACK(fromIp(callbackGetRequest('tok-1'), '198.51.100.7'))

    expect(location(blocked)).toContain('reason=rate_limited')
    expect(fetchMock.mock.calls.length).toBe(callsBefore)

    const otherIp = await CALLBACK(fromIp(callbackGetRequest('tok-1'), '198.51.100.8'))
    expect(location(otherIp)).not.toContain('rate_limited')
  })

  it('webhook: the 121st request in a minute gets 429', async () => {
    for (let i = 0; i < 120; i++) {
      const res = await WEBHOOK(fromIp(webhookRequest({ token: 'unknown' }), '198.51.100.9'))
      expect(res.status).toBe(401)
    }
    const blocked = await WEBHOOK(fromIp(webhookRequest({ token: 'unknown' }), '198.51.100.9'))
    expect(blocked.status).toBe(429)
  })
})

describe('L6: internal errors are not returned to the client', () => {
  const checkoutBody = () => ({
    cartId: randomUUID(),
    guestToken: 'guest-token-1',
    shippingMethod: 'standard',
    acceptedTerms: true,
    idempotencyKey: randomUUID(),
    address: {
      firstName: 'Ayşe',
      lastName: 'Yılmaz',
      email: 'ayse@test.local',
      phone: '05551112233',
      city: 'İstanbul',
      addressLine: 'Örnek Mah. 1',
    },
  })
  const checkout = async () => {
    const res = await CHECKOUT(
      new Request('https://shop.test/api/checkout', { method: 'POST', body: JSON.stringify(checkoutBody()) })
    )
    return { status: res.status, body: (await res.json()) as { error?: string } }
  }
  const cartWith = (sku: string) => ({
    items: [
      {
        sku,
        quantity: 1,
        name: 'Deri Çanta',
        unitPrice: 2000,
        lineTotal: 2000,
        product_id: 'p1',
        imageUrl: null,
        variant: { sku },
        stockStatus: 'ok',
      },
    ],
    subtotal: 2000,
    checkoutBlocked: false,
    hasStockIssues: false,
  })

  it('a payment-provider error message is replaced by a generic one', async () => {
    harness.db.tables.inventory.push({ sku: 'BAG-1', quantity: 5, reserved_quantity: 0 })
    cartState.cart = cartWith('BAG-1')
    harness.iyzico = () => ({ status: 'failure', errorCode: '10051', errorMessage: 'subMerchantKey invalid (internal)' })

    const { status, body } = await checkout()

    expect(status).toBe(400)
    expect(body.error).toBe('Ödeme başlatılamadı. Lütfen tekrar deneyin.')
    expect(body.error).not.toContain('subMerchantKey')
  })

  it('a database error (constraint, column names) is replaced by a generic one', async () => {
    harness.db.tables.inventory.push({ sku: 'BAG-1', quantity: 5, reserved_quantity: 0 })
    cartState.cart = cartWith('BAG-1')
    harness.db.hooks['orders:insert'] = () => {
      throw Object.assign(new Error('duplicate key value violates unique constraint "orders_order_number_key"'), {
        code: '23505',
      })
    }

    const { body } = await checkout()

    expect(body.error).toBe('Ödeme başlatılamadı. Lütfen tekrar deneyin.')
    expect(body.error).not.toMatch(/constraint|orders_/)
  })

  it('business-rule messages are still shown to the customer', async () => {
    cartState.cart = { items: [], subtotal: 0, checkoutBlocked: false, hasStockIssues: false }

    const { body } = await checkout()

    expect(body.error).toBe('Sepet boş')
  })

  it('return requests: business message shown, database error hidden', async () => {
    auth.user = { id: randomUUID(), email: 'c@test.local' }
    const body = JSON.stringify({
      orderId: randomUUID(),
      reason: 'Hasarlı geldi',
      items: [{ orderItemId: randomUUID(), quantity: 1 }],
    })
    const post = async () =>
      (await (await RETURNS(new Request('https://shop.test/api/account/returns', { method: 'POST', body }))).json()) as {
        error?: string
      }

    expect((await post()).error).toBe('Sipariş bulunamadı')

    harness.db.hooks['orders:select'] = () => {
      throw new Error('permission denied for table orders')
    }
    const hidden = await post()
    expect(hidden.error).toBe('İade talebi oluşturulamadı')
  })
})
