/**
 * Payment security regression suite for the checkout-form result handling (M1 follow-up):
 * forged approvals, replayed callbacks, unauthorized confirmation, amount/currency checks,
 * and the unchanged happy path (checkout → iyzico → callback).
 *
 * Real route + service code; Supabase is in-memory and iyzico is a stubbed fetch (no network).
 */
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeDb } from '../helpers/fake-supabase'
import { commitCount, orderRow, seedPendingOrder, stockRow } from '../helpers/orders'

const ctx = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  cart: null as unknown as Record<string, unknown>,
}))

vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ctx.db.client }))
vi.mock('@/lib/payload', () => ({
  getPayloadClient: async () => {
    throw new Error('Payload is not available in unit tests')
  },
}))
vi.mock('@/services/inventory/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/inventory/sync')>()),
  decrementCmsStock: async () => true,
}))
vi.mock('@/services/cart', () => ({
  assertCartAccess: async () => true,
  getCartWithProducts: async () => structuredClone(ctx.cart),
}))
vi.mock('@/services/coupons', () => ({
  validateCoupon: async () => ({ valid: false, error: 'no coupons in this test' }),
}))

import { GET, POST } from '@/app/(frontend)/api/payments/callback/route'
import { POST as WEBHOOK } from '@/app/(frontend)/api/payments/webhook/route'
import { createCheckoutSession } from '@/services/orders'

type Body = Record<string, unknown>
let iyzico: (body: Body) => Body
const fetchMock = vi.fn(async (_url: string, init: { body: string }) => ({
  ok: true,
  status: 200,
  json: async () => iyzico(JSON.parse(init.body)),
}))

const seed = (opts: { token: string; total?: number }) => seedPendingOrder(ctx.db, opts)
const order = (id: string) => orderRow(ctx.db, id)
const stock = (sku: string) => stockRow(ctx.db, sku)
const location = (res: Response) => res.headers.get('location') ?? ''
const callbackGet = (token: string) => GET(new Request(`https://shop.test/api/payments/callback?token=${token}`))
const callbackPost = (fields: Record<string, string>) =>
  POST(
    new Request('https://shop.test/api/payments/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    })
  )

/** iyzico CF retrieve reply for a successful payment of `paidPrice`. */
const success = (paidPrice: string, extra: Body = {}) => (b: Body) => ({
  status: 'success',
  paymentStatus: 'SUCCESS',
  token: b.token,
  paidPrice,
  price: paidPrice,
  currency: 'TRY',
  paymentId: `pay-${String(b.token)}`,
  ...extra,
})

beforeEach(() => {
  ctx.db = createFakeSupabase()
  vi.stubEnv('PAYMENT_PROVIDER', 'iyzico')
  vi.stubEnv('PAYMENT_API_KEY', 'test-api-key')
  vi.stubEnv('PAYMENT_SECRET_KEY', 'test-secret-key')
  vi.stubEnv('PAYMENT_WEBHOOK_SECRET', 'test-webhook-secret')
  vi.stubEnv('IYZICO_BASE_URL', 'https://iyzico.test.invalid')
  vi.stubEnv('PAYLOAD_SECRET', 'test-payload-secret')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.test')
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('forged payment approval', () => {
  it('an unknown token claiming success never marks anything paid', async () => {
    const victim = seed({ token: 'tok-victim' })
    iyzico = success('1000.0')

    const res = await callbackPost({ token: 'forged', conversationId: victim.id, paymentStatus: 'SUCCESS' })

    expect(location(res)).toContain('reason=order_not_found')
    expect(order(victim.id).payment_status).toBe('pending')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('success fields in the callback body are ignored when iyzico has no result yet', async () => {
    const o = seed({ token: 'tok-1' })
    iyzico = (b) => ({ status: 'success', token: b.token }) // no paymentStatus → still pending

    const res = await callbackPost({ token: 'tok-1', paymentStatus: 'SUCCESS', paidPrice: '1000.0' })

    expect(location(res)).toContain('reason=pending')
    expect(order(o.id).payment_status).toBe('pending')
  })

  it('a body claiming success cannot override an iyzico FAILURE', async () => {
    const o = seed({ token: 'tok-1' })
    iyzico = (b) => ({ status: 'success', paymentStatus: 'FAILURE', token: b.token })

    await callbackPost({ token: 'tok-1', paymentStatus: 'SUCCESS' })

    expect(order(o.id).payment_status).toBe('failed')
  })

  it('an unsigned webhook without a token cannot confirm a payment', async () => {
    const o = seed({ token: 'tok-1' })
    const res = await WEBHOOK(
      new Request('https://shop.test/api/payments/webhook', {
        method: 'POST',
        body: JSON.stringify({ conversationId: o.id, paymentStatus: 'SUCCESS', paidPrice: '1000.0' }),
      })
    )

    expect(res.status).toBe(401)
    expect(order(o.id).payment_status).toBe('pending')
  })

  it('a webhook with a forged signature is rejected', async () => {
    const o = seed({ token: 'tok-1' })
    const res = await WEBHOOK(
      new Request('https://shop.test/api/payments/webhook', {
        method: 'POST',
        headers: { 'x-iyzico-signature': 'f'.repeat(64) },
        body: JSON.stringify({ conversationId: o.id, paymentStatus: 'SUCCESS', paidPrice: '1000.0' }),
      })
    )

    expect(res.status).toBe(401)
    expect(order(o.id).payment_status).toBe('pending')
  })

  it('a result whose basketId belongs to another order is rejected', async () => {
    const o = seed({ token: 'tok-1' })
    const other = seed({ token: 'tok-2' })
    iyzico = success('1000.0', { basketId: other.orderNumber })

    const res = await callbackGet('tok-1')

    expect(location(res)).toContain('reason=invalid')
    expect(order(o.id).payment_status).toBe('pending')
    expect(order(other.id).payment_status).toBe('pending')
  })
})

describe('replayed callbacks', () => {
  it('replaying a successful callback commits stock exactly once', async () => {
    const o = seed({ token: 'tok-1' })
    iyzico = success('1000.0')

    for (let i = 0; i < 3; i++) {
      expect(location(await callbackGet('tok-1'))).toContain('/checkout/success')
    }

    expect(order(o.id).payment_status).toBe('paid')
    expect(commitCount(ctx.db)).toBe(1)
    expect(stock(o.sku)).toMatchObject({ quantity: 4, reserved_quantity: 0 })
  })

  it('concurrent duplicate callbacks commit stock exactly once', async () => {
    const o = seed({ token: 'tok-1' })
    iyzico = success('1000.0')

    await Promise.all(Array.from({ length: 5 }, () => callbackGet('tok-1')))

    expect(order(o.id).payment_status).toBe('paid')
    expect(commitCount(ctx.db)).toBe(1)
    expect(stock(o.sku)).toMatchObject({ quantity: 4, reserved_quantity: 0 })
  })

  it('a webhook arriving after the callback still recognises the paid token', async () => {
    const o = seed({ token: 'tok-1' })
    iyzico = success('1000.0')
    await callbackGet('tok-1')

    const res = await WEBHOOK(
      new Request('https://shop.test/api/payments/webhook', {
        method: 'POST',
        body: JSON.stringify({ token: 'tok-1' }),
      })
    )

    expect(res.status).toBe(200)
    expect(ctx.db.tables.payments[0]).toMatchObject({ status: 'paid', provider_payment_id: 'tok-1' })
    expect(commitCount(ctx.db)).toBe(1)
    expect(order(o.id).payment_status).toBe('paid')
  })

  it('a later FAILURE replay cannot cancel an already paid order', async () => {
    const o = seed({ token: 'tok-1' })
    iyzico = success('1000.0')
    await callbackGet('tok-1')

    iyzico = (b) => ({ status: 'success', paymentStatus: 'FAILURE', token: b.token })
    await callbackGet('tok-1')

    expect(order(o.id)).toMatchObject({ status: 'payment_received', payment_status: 'paid' })
    expect(stock(o.sku)).toMatchObject({ quantity: 4, reserved_quantity: 0 })
  })
})

describe('amount and currency validation', () => {
  it.each([
    ['underpaid', '999.0', 'TRY'],
    ['overpaid (installment commission, see H1)', '1045.5', 'TRY'],
    ['wrong currency', '1000.0', 'USD'],
  ])('%s → order is not marked paid', async (_label, paidPrice, currency) => {
    const o = seed({ token: 'tok-1', total: 1000 })
    iyzico = success(paidPrice, { currency })

    const res = await callbackGet('tok-1')

    expect(location(res)).toContain('reason=finalize')
    expect(order(o.id).payment_status).toBe('pending')
    expect(commitCount(ctx.db)).toBe(0)
  })

  it('a SUCCESS without paidPrice is not accepted', async () => {
    const o = seed({ token: 'tok-1' })
    iyzico = (b) => ({ status: 'success', paymentStatus: 'SUCCESS', token: b.token, currency: 'TRY' })

    await callbackGet('tok-1')

    expect(order(o.id).payment_status).toBe('pending')
  })
})

describe('happy path: checkout → iyzico → callback', () => {
  it('creates the order, stores the issued token and finalizes on callback', async () => {
    const cartId = randomUUID()
    ctx.db.tables.inventory.push({ sku: 'BAG-1', quantity: 3, reserved_quantity: 0 })
    ctx.db.tables.cart_items.push({ id: randomUUID(), cart_id: cartId, sku: 'BAG-1', quantity: 1 })
    ctx.cart = {
      items: [
        {
          sku: 'BAG-1',
          quantity: 1,
          name: 'Deri Çanta',
          unitPrice: 2000,
          lineTotal: 2000,
          product_id: 'p1',
          imageUrl: null,
          variant: { sku: 'BAG-1' },
          stockStatus: 'ok',
        },
      ],
      subtotal: 2000,
      checkoutBlocked: false,
      hasStockIssues: false,
    }
    iyzico = (b) =>
      b.basketItems
        ? { status: 'success', token: 'cf-token-1', paymentPageUrl: 'https://pay.test/cf-token-1' }
        : success('2000.0')(b)

    const session = await createCheckoutSession({
      cartId,
      guestToken: 'guest-token-1',
      userId: null,
      shippingMethod: 'standard',
      address: {
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        email: 'ayse@test.local',
        phone: '05551112233',
        city: 'İstanbul',
        addressLine: 'Örnek Mah. 1',
      },
      couponCode: null,
      idempotencyKey: 'idem-key-0001',
      clientIp: '203.0.113.10',
    })

    expect(session.payment?.paymentPageUrl).toBe('https://pay.test/cf-token-1')
    expect(stock('BAG-1')).toMatchObject({ quantity: 3, reserved_quantity: 1 })
    expect(ctx.db.tables.payments[0]).toMatchObject({ order_id: session.order.id, provider_payment_id: 'cf-token-1' })

    const res = await callbackPost({ token: 'cf-token-1' })

    expect(location(res)).toContain(`/checkout/success?orderId=${session.order.id}&t=`)
    expect(order(session.order.id)).toMatchObject({ status: 'payment_received', payment_status: 'paid' })
    expect(stock('BAG-1')).toMatchObject({ quantity: 2, reserved_quantity: 0 })
    expect(ctx.db.tables.cart_items.filter((i) => i.cart_id === cartId)).toHaveLength(0)
  })
})
