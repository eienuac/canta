/**
 * L5 — every checkout attempt keeps its own token; payments on old pages are matched and a
 * second charge is flagged for refund. Admin review/refund actions (migration 008 RPCs).
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { orderRow, seedPendingOrder, stockRow } from '../helpers/orders'
import {
  callbackGetRequest,
  harness,
  iyzicoFailure,
  iyzicoSuccess,
  setupPaymentHarness,
} from '../helpers/payment-harness'

const ctx = vi.hoisted(() => ({
  cart: null as unknown as Record<string, unknown>,
  user: null as Record<string, unknown> | null,
  role: 'customer',
}))

vi.mock('@/lib/supabase/admin', () => import('../helpers/mocks/supabase-admin'))
vi.mock('@/lib/payload', () => import('../helpers/mocks/payload'))
vi.mock('@/services/cart', () => ({
  assertCartAccess: async () => true,
  getCartWithProducts: async () => structuredClone(ctx.cart),
}))
vi.mock('@/services/coupons', () => ({ validateCoupon: async () => ({ valid: false, error: 'x' }) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: ctx.user } }) } }),
}))
vi.mock('@/lib/admin', () => ({
  requireAppAdmin: async () => (ctx.role === 'admin' && ctx.user ? { user: ctx.user, profile: { role: 'admin' } } : null),
}))

import { GET as CALLBACK } from '@/app/(frontend)/api/payments/callback/route'
import { PATCH as ADMIN_ORDERS } from '@/app/(frontend)/api/app-admin/orders/route'
import { createCheckoutSession } from '@/services/orders'

setupPaymentHarness()

const order = (id: string) => orderRow(harness.db, id)
const payments = (orderId: string) => harness.db.tables.payments.filter((p) => p.order_id === orderId)

describe('L5: checkout attempts', () => {
  const input = (idempotencyKey: string, cartId: string) => ({
    cartId,
    guestToken: 'guest-token-1',
    userId: null,
    shippingMethod: 'standard' as const,
    address: {
      firstName: 'Ayşe',
      lastName: 'Yılmaz',
      email: 'ayse@test.local',
      phone: '05551112233',
      city: 'İstanbul',
      addressLine: 'Örnek Mah. 1',
    },
    couponCode: null,
    idempotencyKey,
    clientIp: '203.0.113.10',
  })

  function setupCart() {
    const cartId = randomUUID()
    harness.db.tables.inventory.push({ sku: 'BAG-1', quantity: 3, reserved_quantity: 0 })
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
    let n = 0
    harness.iyzico = (b) =>
      b.basketItems
        ? { status: 'success', token: `cf-${++n}`, paymentPageUrl: `https://pay.test/cf-${n}` }
        : iyzicoSuccess('2000.0')(b)
    return cartId
  }

  it('a repeated checkout keeps the old token (superseded) and adds a new attempt', async () => {
    const cartId = setupCart()
    const first = await createCheckoutSession(input('idem-key-0001', cartId))
    await createCheckoutSession(input('idem-key-0001', cartId))

    const rows = payments(first.order.id)
    expect(rows.map((p) => p.provider_payment_id)).toEqual(['cf-1', 'cf-2'])
    expect(rows[0].superseded_at).toBeTruthy()
    expect(rows[1].superseded_at).toBeFalsy()
  })

  it('paying on the OLD page still completes the order; paying again is flagged for refund', async () => {
    const cartId = setupCart()
    const first = await createCheckoutSession(input('idem-key-0002', cartId))
    await createCheckoutSession(input('idem-key-0002', cartId))

    await CALLBACK(callbackGetRequest('cf-1'))
    expect(order(first.order.id)).toMatchObject({ status: 'payment_received', payment_status: 'paid' })
    expect(stockRow(harness.db, 'BAG-1')).toMatchObject({ quantity: 2, reserved_quantity: 0 })

    await CALLBACK(callbackGetRequest('cf-2'))
    const second = payments(first.order.id).find((p) => p.provider_payment_id === 'cf-2')!
    expect(second).toMatchObject({ status: 'paid', refund_state: 'required' })
    expect(order(first.order.id)).toMatchObject({ status: 'payment_received', needs_review: true })
    expect(stockRow(harness.db, 'BAG-1')).toMatchObject({ quantity: 2, reserved_quantity: 0 }) // once
  })

  it('a failure on a superseded attempt does not cancel the order', async () => {
    const cartId = setupCart()
    const first = await createCheckoutSession(input('idem-key-0003', cartId))
    await createCheckoutSession(input('idem-key-0003', cartId))
    harness.iyzico = iyzicoFailure()

    await CALLBACK(callbackGetRequest('cf-1'))

    expect(order(first.order.id)).toMatchObject({ status: 'pending_payment', payment_status: 'pending' })
    expect(payments(first.order.id).map((p) => p.status)).toEqual(['failed', 'pending'])
  })
})

describe('admin: payment review and manual refund', () => {
  const patch = async (body: unknown) => {
    const res = await ADMIN_ORDERS(
      new Request('https://shop.test/api/app-admin/orders', { method: 'PATCH', body: JSON.stringify(body) })
    )
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  const asAdmin = () => {
    ctx.user = { id: randomUUID(), email: 'owner@test.local' }
    ctx.role = 'admin'
  }

  it('non-admins are rejected', async () => {
    ctx.user = { id: randomUUID() }
    ctx.role = 'customer'
    expect((await patch({ action: 'approve_review', orderId: randomUUID() })).status).toBe(403)
  })

  it('approving a review order commits stock and completes it', async () => {
    asAdmin()
    const o = seedPendingOrder(harness.db, { token: 'tok-1', total: 1000 })
    harness.iyzico = iyzicoSuccess('900.0') // amount mismatch → review
    await CALLBACK(callbackGetRequest('tok-1'))
    expect(order(o.id).status).toBe('payment_review')

    const res = await patch({ action: 'approve_review', orderId: o.id, note: 'Müşteriyle görüşüldü' })

    expect(res.status).toBe(200)
    expect(order(o.id)).toMatchObject({ status: 'payment_received', needs_review: false, reviewed_by: ctx.user!.id })
    expect(stockRow(harness.db, o.sku)).toMatchObject({ quantity: 4, reserved_quantity: 0 })
  })

  it('approving an order that is not in review returns a clear message', async () => {
    asAdmin()
    const o = seedPendingOrder(harness.db, { token: 'tok-1' })
    const res = await patch({ action: 'approve_review', orderId: o.id })
    expect(res).toEqual({ status: 400, body: { error: 'Sipariş ödeme incelemesinde değil.' } })
  })

  it('recording a manual refund requires a reference and marks the order refunded', async () => {
    asAdmin()
    const o = seedPendingOrder(harness.db, { token: 'tok-1' })
    harness.iyzico = iyzicoSuccess('1000.0')
    await CALLBACK(callbackGetRequest('tok-1'))
    const pay = payments(o.id)[0]

    expect((await patch({ action: 'record_refund', paymentId: pay.id, reference: '' })).status).toBe(400)
    const ok = await patch({ action: 'record_refund', paymentId: pay.id, reference: 'IYZ-REF-123' })

    expect(ok.status).toBe(200)
    expect(pay).toMatchObject({ refund_state: 'succeeded', refund_reference: 'IYZ-REF-123' })
    expect(order(o.id).payment_status).toBe('refunded')
  })

  it('a transition rejected by the database guard is shown as a Turkish message', async () => {
    asAdmin()
    const o = seedPendingOrder(harness.db, { token: 'tok-1' })
    harness.db.hooks['orders:update'] = () => ({
      data: null,
      error: { message: 'invalid order status transition pending_payment -> shipped', code: '23514' },
    })

    const res = await patch({ orderId: o.id, status: 'shipped' })

    expect(res).toEqual({ status: 400, body: { error: 'Bu durum geçişine izin verilmiyor.' } })
  })

  it('unknown statuses are rejected before reaching the database', async () => {
    asAdmin()
    const res = await patch({ orderId: randomUUID(), status: 'teleported' })
    expect(res.status).toBe(400)
  })
})
