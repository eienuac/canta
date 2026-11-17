/**
 * Payment security regression suite for checkout-form result handling (M1 follow-up):
 * forged approvals, replayed callbacks, unauthorized confirmation, amount/currency checks,
 * and the unchanged happy path (checkout → iyzico → callback).
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { commitCount, orderRow, seedPendingOrder, stockRow } from '../helpers/orders'
import {
  callbackGetRequest,
  callbackPostRequest,
  fetchMock,
  harness,
  iyzicoFailure,
  iyzicoSuccess,
  location,
  setupPaymentHarness,
  webhookRequest,
} from '../helpers/payment-harness'

const cartState = vi.hoisted(() => ({ cart: null as unknown as Record<string, unknown> }))

vi.mock('@/lib/supabase/admin', () => import('../helpers/mocks/supabase-admin'))
vi.mock('@/lib/payload', () => import('../helpers/mocks/payload'))
vi.mock('@/services/inventory/sync', async (orig) =>
  (await import('../helpers/mocks/inventory-sync')).withStubbedCmsStock(orig)
)
vi.mock('@/services/cart', () => ({
  assertCartAccess: async () => true,
  getCartWithProducts: async () => structuredClone(cartState.cart),
}))
vi.mock('@/services/coupons', () => ({
  validateCoupon: async () => ({ valid: false, error: 'no coupons in this test' }),
}))

import { GET, POST } from '@/app/(frontend)/api/payments/callback/route'
import { POST as WEBHOOK } from '@/app/(frontend)/api/payments/webhook/route'
import { createCheckoutSession } from '@/services/orders'

setupPaymentHarness()

const seed = (token: string, total?: number) => seedPendingOrder(harness.db, { token, total })
const order = (id: string) => orderRow(harness.db, id)
const stock = (sku: string) => stockRow(harness.db, sku)
const callbackGet = (token: string) => GET(callbackGetRequest(token))

describe('forged payment approval', () => {
  it('an unknown token claiming success never marks anything paid', async () => {
    const victim = seed('tok-victim')
    harness.iyzico = iyzicoSuccess('1000.0')

    const res = await POST(callbackPostRequest({ token: 'forged', conversationId: victim.id, paymentStatus: 'SUCCESS' }))

    expect(location(res)).toContain('reason=order_not_found')
    expect(order(victim.id).payment_status).toBe('pending')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('success fields in the callback body are ignored when iyzico has no result yet', async () => {
    const o = seed('tok-1')
    harness.iyzico = (b) => ({ status: 'success', token: b.token }) // no paymentStatus → pending

    const res = await POST(callbackPostRequest({ token: 'tok-1', paymentStatus: 'SUCCESS', paidPrice: '1000.0' }))

    expect(location(res)).toContain('reason=pending')
    expect(order(o.id).payment_status).toBe('pending')
  })

  it('a body claiming success cannot override an iyzico FAILURE', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoFailure()

    await POST(callbackPostRequest({ token: 'tok-1', paymentStatus: 'SUCCESS' }))

    expect(order(o.id).payment_status).toBe('failed')
  })

  it('an unsigned webhook without a token cannot confirm a payment', async () => {
    const o = seed('tok-1')

    const res = await WEBHOOK(webhookRequest({ conversationId: o.id, paymentStatus: 'SUCCESS', paidPrice: '1000.0' }))

    expect(res.status).toBe(401)
    expect(order(o.id).payment_status).toBe('pending')
  })

  it('a webhook with a forged signature is rejected', async () => {
    const o = seed('tok-1')

    const res = await WEBHOOK(
      webhookRequest(
        { conversationId: o.id, paymentStatus: 'SUCCESS', paidPrice: '1000.0' },
        { 'x-iyzico-signature': 'f'.repeat(64) }
      )
    )

    expect(res.status).toBe(401)
    expect(order(o.id).payment_status).toBe('pending')
  })

  it('a result whose basketId belongs to another order is rejected', async () => {
    const o = seed('tok-1')
    const other = seed('tok-2')
    harness.iyzico = iyzicoSuccess('1000.0', { basketId: other.orderNumber })

    const res = await callbackGet('tok-1')

    expect(location(res)).toContain('reason=invalid')
    expect(order(o.id).payment_status).toBe('pending')
    expect(order(other.id).payment_status).toBe('pending')
  })
})

describe('replayed callbacks', () => {
  it('replaying a successful callback commits stock exactly once', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoSuccess('1000.0')

    for (let i = 0; i < 3; i++) {
      expect(location(await callbackGet('tok-1'))).toContain('/checkout/success')
    }

    expect(order(o.id).payment_status).toBe('paid')
    expect(commitCount(harness.db)).toBe(1)
    expect(stock(o.sku)).toMatchObject({ quantity: 4, reserved_quantity: 0 })
  })

  it('concurrent duplicate callbacks commit stock exactly once', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoSuccess('1000.0')

    await Promise.all(Array.from({ length: 5 }, () => callbackGet('tok-1')))

    expect(order(o.id).payment_status).toBe('paid')
    expect(commitCount(harness.db)).toBe(1)
    expect(stock(o.sku)).toMatchObject({ quantity: 4, reserved_quantity: 0 })
  })

  it('a webhook arriving after the callback still recognises the paid token', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoSuccess('1000.0')
    await callbackGet('tok-1')

    const res = await WEBHOOK(webhookRequest({ token: 'tok-1' }))

    expect(res.status).toBe(200)
    expect(harness.db.tables.payments[0]).toMatchObject({ status: 'paid', provider_payment_id: 'tok-1' })
    expect(commitCount(harness.db)).toBe(1)
    expect(order(o.id).payment_status).toBe('paid')
  })

  it('a later FAILURE replay cannot cancel an already paid order', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoSuccess('1000.0')
    await callbackGet('tok-1')

    harness.iyzico = iyzicoFailure()
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
    const o = seed('tok-1', 1000)
    harness.iyzico = iyzicoSuccess(paidPrice, { currency })

    const res = await callbackGet('tok-1')

    expect(location(res)).toContain('reason=finalize')
    expect(order(o.id).payment_status).toBe('pending')
    expect(commitCount(harness.db)).toBe(0)
  })

  it('a SUCCESS without paidPrice is not accepted', async () => {
    const o = seed('tok-1')
    harness.iyzico = (b) => ({ status: 'success', paymentStatus: 'SUCCESS', token: b.token, currency: 'TRY' })

    await callbackGet('tok-1')

    expect(order(o.id).payment_status).toBe('pending')
  })
})

describe('happy path: checkout → iyzico → callback', () => {
  it('creates the order, stores the issued token and finalizes on callback', async () => {
    const cartId = randomUUID()
    harness.db.tables.inventory.push({ sku: 'BAG-1', quantity: 3, reserved_quantity: 0 })
    harness.db.tables.cart_items.push({ id: randomUUID(), cart_id: cartId, sku: 'BAG-1', quantity: 1 })
    cartState.cart = {
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
    harness.iyzico = (b) =>
      b.basketItems
        ? { status: 'success', token: 'cf-token-1', paymentPageUrl: 'https://pay.test/cf-token-1' }
        : iyzicoSuccess('2000.0')(b)

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
    expect(harness.db.tables.payments[0]).toMatchObject({
      order_id: session.order.id,
      provider_payment_id: 'cf-token-1',
    })

    const res = await POST(callbackPostRequest({ token: 'cf-token-1' }))

    expect(location(res)).toContain(`/checkout/success?orderId=${session.order.id}&t=`)
    expect(order(session.order.id)).toMatchObject({ status: 'payment_received', payment_status: 'paid' })
    expect(stock('BAG-1')).toMatchObject({ quantity: 2, reserved_quantity: 0 })
    expect(harness.db.tables.cart_items.filter((i) => i.cart_id === cartId)).toHaveLength(0)
  })
})
