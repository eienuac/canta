/**
 * Payment security regression suite for checkout-form result handling (M1 follow-up):
 * forged approvals, replayed callbacks, unauthorized confirmation, amount/currency checks,
 * and the unchanged happy path (checkout → iyzico → callback).
 */
import { createHmac, randomUUID } from 'node:crypto'
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
        { 'x-iyz-signature-v3': 'f'.repeat(64) }
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

describe('amount and currency validation (H1)', () => {
  it.each([
    ['underpaid', '999.0', '999.0', 'TRY', 'AMOUNT_MISMATCH'],
    ['charged less than the basket price', '1000.0', '990.0', 'TRY', 'PAID_LESS_THAN_PRICE'],
    ['wrong currency', '1000.0', '1000.0', 'USD', 'CURRENCY_MISMATCH'],
  ])('%s → payment kept, order held for review, no stock change', async (_label, price, paidPrice, currency, reason) => {
    const o = seed('tok-1', 1000)
    harness.iyzico = iyzicoSuccess(paidPrice, { price, currency })

    const res = await callbackGet('tok-1')

    expect(location(res)).toContain(`/checkout/success?orderId=${o.id}`)
    expect(order(o.id)).toMatchObject({ status: 'payment_review', payment_status: 'paid', review_reason: reason })
    expect(harness.db.tables.payments[0]).toMatchObject({ status: 'paid' })
    expect(commitCount(harness.db)).toBe(0)
  })

  it('installment interest (paidPrice > price) completes the order normally', async () => {
    const o = seed('tok-1', 1000)
    harness.iyzico = iyzicoSuccess('1045.5', { price: '1000.0', installment: 6 })

    await callbackGet('tok-1')

    expect(order(o.id)).toMatchObject({ status: 'payment_received', payment_status: 'paid' })
    expect(harness.db.tables.payments[0]).toMatchObject({ price: 1000, paid_price: 1045.5, installment: 6 })
    expect(commitCount(harness.db)).toBe(1)
  })

  it('a SUCCESS without amounts is held for review, never completed', async () => {
    const o = seed('tok-1')
    harness.iyzico = (b) => ({ status: 'success', paymentStatus: 'SUCCESS', token: b.token, currency: 'TRY' })

    await callbackGet('tok-1')

    expect(order(o.id)).toMatchObject({ status: 'payment_review', payment_status: 'paid' })
    expect(commitCount(harness.db)).toBe(0)
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

describe('iyzico webhook signature (X-IYZ-SIGNATURE-V3)', () => {
  const SECRET = 'test-secret-key' // PAYMENT_SECRET_KEY in the harness
  /** Formula from docs.iyzico.com/en/advanced/webhook (HPP format), computed independently here. */
  const sign = (p: Record<string, string | number>, secret = SECRET) =>
    createHmac('sha256', secret)
      .update(`${secret}${p.iyziEventType}${p.iyziPaymentId}${p.token}${p.paymentConversationId}${p.status}`)
      .digest('hex')
  const hpp = (token: string, orderId: string, status = 'SUCCESS') => ({
    paymentConversationId: orderId,
    merchantId: '123456',
    token,
    status,
    iyziReferenceCode: randomUUID(),
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziEventTime: 1763500000000,
    iyziPaymentId: 27000001,
  })
  const signedWebhook = (body: ReturnType<typeof hpp>, signature = sign(body)) =>
    WEBHOOK(webhookRequest(body, { 'X-IYZ-SIGNATURE-V3': signature }))

  it('a correctly signed notification completes the order (after retrieving the result)', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoSuccess('1000.0')

    const res = await signedWebhook(hpp('tok-1', o.id))

    expect(res.status).toBe(200)
    expect(order(o.id)).toMatchObject({ status: 'payment_received', payment_status: 'paid' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('an uppercase hex signature is accepted', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoSuccess('1000.0')
    const body = hpp('tok-1', o.id)

    expect((await signedWebhook(body, sign(body).toUpperCase())).status).toBe(200)
  })

  it('a signature made with another key, or over altered fields, is rejected without calling iyzico', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoSuccess('1000.0')
    const body = hpp('tok-1', o.id)

    expect((await signedWebhook(body, sign(body, 'attacker-key'))).status).toBe(401)
    expect((await signedWebhook({ ...body, status: 'FAILURE' }, sign(body))).status).toBe(401)
    expect(order(o.id).payment_status).toBe('pending')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a valid signature does not let the body override what iyzico reports', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoFailure()

    await signedWebhook(hpp('tok-1', o.id, 'SUCCESS'))

    expect(order(o.id).payment_status).toBe('failed')
  })

  it('signed notifications for tokens or formats this shop does not use are acknowledged and ignored', async () => {
    const unknown = hpp('not-ours', randomUUID())
    expect(await (await signedWebhook(unknown)).json()).toEqual({ ok: true, ignored: true })

    const direct = { iyziEventType: 'PAYMENT_API', paymentId: '1', paymentConversationId: 'x', status: 'SUCCESS' }
    const directSig = createHmac('sha256', SECRET).update(`${SECRET}PAYMENT_API1xSUCCESS`).digest('hex')
    const res = await WEBHOOK(webhookRequest(direct, { 'x-iyz-signature-v3': directSig }))
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the old unofficial header is not a bypass: the result is still retrieved from iyzico', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoFailure()
    const body = { token: 'tok-1', conversationId: o.id, paymentStatus: 'SUCCESS', paidPrice: '1000.0' }
    const legacy = createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex')

    await WEBHOOK(webhookRequest(body, { 'x-iyzico-signature': legacy }))

    expect(order(o.id).payment_status).toBe('failed')
  })

  it('with IYZICO_WEBHOOK_REQUIRE_SIGNATURE=true unsigned notifications are refused', async () => {
    vi.stubEnv('IYZICO_WEBHOOK_REQUIRE_SIGNATURE', 'true')
    const o = seed('tok-1')
    harness.iyzico = iyzicoSuccess('1000.0')

    expect((await WEBHOOK(webhookRequest({ token: 'tok-1' }))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await signedWebhook(hpp('tok-1', o.id))).status).toBe(200)
    expect(order(o.id).payment_status).toBe('paid')
  })
})
