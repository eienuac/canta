/**
 * M1 — forged / unverifiable checkout callbacks must never change another order.
 * Real callback + webhook routes and order service; in-memory Supabase; stubbed iyzico.
 */
import { describe, expect, it, vi } from 'vitest'
import { orderRow, seedPendingOrder, stockRow } from '../helpers/orders'
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

vi.mock('@/lib/supabase/admin', () => import('../helpers/mocks/supabase-admin'))
vi.mock('@/lib/payload', () => import('../helpers/mocks/payload'))
vi.mock('@/services/inventory/sync', async (orig) =>
  (await import('../helpers/mocks/inventory-sync')).withStubbedCmsStock(orig)
)

import { GET, POST } from '@/app/(frontend)/api/payments/callback/route'
import { POST as WEBHOOK } from '@/app/(frontend)/api/payments/webhook/route'

setupPaymentHarness()

const seed = (token: string) => seedPendingOrder(harness.db, { token })
const order = (id: string) => orderRow(harness.db, id)
const stock = (sku: string) => stockRow(harness.db, sku)

describe('M1: forged callbacks', () => {
  it('unknown token + victim conversationId: victim untouched and iyzico is never called', async () => {
    const victim = seed('tok-victim')
    harness.iyzico = () => ({ status: 'failure', errorCode: '5021' })

    const res = await POST(callbackPostRequest({ token: 'garbage', conversationId: victim.id }))

    expect(location(res)).toContain('reason=order_not_found')
    expect(order(victim.id).payment_status).toBe('pending')
    expect(stock(victim.sku).reserved_quantity).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("attacker's own failed token + victim conversationId: only the attacker's order changes", async () => {
    const victim = seed('tok-victim')
    const attacker = seed('tok-attacker')
    harness.iyzico = iyzicoFailure()

    await POST(callbackPostRequest({ token: 'tok-attacker', conversationId: victim.id }))

    expect(order(victim.id).payment_status).toBe('pending')
    expect(stock(victim.sku).reserved_quantity).toBe(1)
    expect(order(attacker.id).payment_status).toBe('failed')
  })

  it('iyzico API error for a known token changes nothing (not treated as a failed payment)', async () => {
    const o = seed('tok-1')
    harness.iyzico = () => ({ status: 'failure', errorCode: '5021', errorMessage: 'token not found' })

    const res = await GET(callbackGetRequest('tok-1'))

    expect(location(res)).toContain('reason=invalid')
    expect(order(o.id).payment_status).toBe('pending')
    expect(stock(o.sku).reserved_quantity).toBe(1)
  })

  it('provider result for another order (conversationId mismatch) changes nothing', async () => {
    const a = seed('tok-a')
    const b = seed('tok-b')
    harness.iyzico = iyzicoFailure({ conversationId: b.id })

    const res = await GET(callbackGetRequest('tok-a'))

    expect(location(res)).toContain('reason=invalid')
    expect(order(a.id).payment_status).toBe('pending')
    expect(order(b.id).payment_status).toBe('pending')
  })

  it('provider echoing a different token is rejected', async () => {
    const o = seed('tok-1')
    harness.iyzico = () => ({ status: 'success', paymentStatus: 'FAILURE', token: 'tok-other' })

    await GET(callbackGetRequest('tok-1'))

    expect(order(o.id).payment_status).toBe('pending')
  })

  it('paid-path injection with a paid token for another order is blocked', async () => {
    const victim = seed('tok-victim')
    seed('tok-attacker')
    harness.iyzico = iyzicoSuccess('1000.0')

    await POST(callbackPostRequest({ token: 'tok-attacker', conversationId: victim.id }))

    expect(order(victim.id).payment_status).toBe('pending')
  })
})

describe('M1: legitimate results still work', () => {
  it('genuine FAILURE cancels the order and releases its reservation', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoFailure()

    const res = await POST(callbackPostRequest({ token: 'tok-1' }))

    expect(location(res)).toContain('reason=payment_failed')
    expect(order(o.id)).toMatchObject({ status: 'cancelled', payment_status: 'failed' })
    expect(stock(o.sku).reserved_quantity).toBe(0)
  })

  it('genuine SUCCESS finalizes the order and redirects with an access token', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoSuccess('1000.0', { conversationId: o.id, basketId: o.orderNumber })

    const res = await GET(callbackGetRequest('tok-1'))

    expect(location(res)).toMatch(new RegExp(`/checkout/success\\?orderId=${o.id}&t=[0-9a-f]{32}`))
    expect(order(o.id)).toMatchObject({ status: 'payment_received', payment_status: 'paid' })
    expect(stock(o.sku)).toMatchObject({ quantity: 4, reserved_quantity: 0 })
  })
})

describe('M1: unsigned webhook uses the same verification', () => {
  it('rejects an unknown token without calling iyzico', async () => {
    const victim = seed('tok-victim')

    const res = await WEBHOOK(webhookRequest({ token: 'garbage', conversationId: victim.id, paymentStatus: 'FAILURE' }))

    expect(res.status).toBe(401)
    expect(order(victim.id).payment_status).toBe('pending')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores body status fields and uses the retrieved result', async () => {
    const o = seed('tok-1')
    harness.iyzico = iyzicoSuccess('1000.0')

    const res = await WEBHOOK(webhookRequest({ token: 'tok-1', paymentStatus: 'FAILURE' }))

    expect(res.status).toBe(200)
    expect(order(o.id).payment_status).toBe('paid')
  })
})
