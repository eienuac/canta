/**
 * M1 — forged / unverifiable checkout callbacks must never change another order.
 * Runs the real callback + webhook routes and order service against an in-memory Supabase;
 * iyzico is replaced by a stubbed fetch (no network).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeDb } from '../helpers/fake-supabase'
import { orderRow, seedPendingOrder, stockRow } from '../helpers/orders'

const ctx = vi.hoisted(() => ({ db: null as unknown as FakeDb }))

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

import { GET, POST } from '@/app/(frontend)/api/payments/callback/route'
import { POST as WEBHOOK } from '@/app/(frontend)/api/payments/webhook/route'

type IyzicoReply = Record<string, unknown>
let iyzico: (req: { token: string }) => IyzicoReply
const fetchMock = vi.fn(async (_url: string, init: { body: string }) => ({
  ok: true,
  status: 200,
  json: async () => iyzico(JSON.parse(init.body)),
}))

const seedOrder = (opts: { token: string; total?: number; sku?: string }) => seedPendingOrder(ctx.db, opts)

const order = (id: string) => orderRow(ctx.db, id)
const stock = (sku: string) => stockRow(ctx.db, sku)
const location = (res: Response) => res.headers.get('location') ?? ''

function formPost(fields: Record<string, string>) {
  return new Request('https://shop.test/api/payments/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  })
}

beforeEach(() => {
  ctx.db = createFakeSupabase()
  vi.stubEnv('PAYMENT_PROVIDER', 'iyzico')
  vi.stubEnv('PAYMENT_API_KEY', 'test-api-key')
  vi.stubEnv('PAYMENT_SECRET_KEY', 'test-secret-key')
  vi.stubEnv('IYZICO_BASE_URL', 'https://iyzico.test.invalid')
  vi.stubEnv('PAYLOAD_SECRET', 'test-payload-secret')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.test')
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('M1: forged callbacks', () => {
  it('unknown token + victim conversationId: victim untouched and iyzico is never called', async () => {
    const victim = seedOrder({ token: 'tok-victim' })
    iyzico = () => ({ status: 'failure', errorCode: '5021' })

    const res = await POST(formPost({ token: 'garbage', conversationId: victim.id }))

    expect(location(res)).toContain('reason=order_not_found')
    expect(order(victim.id).payment_status).toBe('pending')
    expect(stock(victim.sku).reserved_quantity).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("attacker's own failed token + victim conversationId: only the attacker's order changes", async () => {
    const victim = seedOrder({ token: 'tok-victim' })
    const attacker = seedOrder({ token: 'tok-attacker' })
    iyzico = ({ token }) => ({ status: 'success', paymentStatus: 'FAILURE', token })

    await POST(formPost({ token: 'tok-attacker', conversationId: victim.id }))

    expect(order(victim.id).payment_status).toBe('pending')
    expect(stock(victim.sku).reserved_quantity).toBe(1)
    expect(order(attacker.id).payment_status).toBe('failed')
  })

  it('iyzico API error for a known token changes nothing (not treated as a failed payment)', async () => {
    const o = seedOrder({ token: 'tok-1' })
    iyzico = () => ({ status: 'failure', errorCode: '5021', errorMessage: 'token not found' })

    const res = await GET(new Request('https://shop.test/api/payments/callback?token=tok-1'))

    expect(location(res)).toContain('reason=invalid')
    expect(order(o.id).payment_status).toBe('pending')
    expect(stock(o.sku).reserved_quantity).toBe(1)
  })

  it('provider result for another order (conversationId mismatch) changes nothing', async () => {
    const a = seedOrder({ token: 'tok-a' })
    const b = seedOrder({ token: 'tok-b' })
    iyzico = ({ token }) => ({
      status: 'success',
      paymentStatus: 'FAILURE',
      token,
      conversationId: b.id,
    })

    const res = await GET(new Request('https://shop.test/api/payments/callback?token=tok-a'))

    expect(location(res)).toContain('reason=invalid')
    expect(order(a.id).payment_status).toBe('pending')
    expect(order(b.id).payment_status).toBe('pending')
  })

  it('provider echoing a different token is rejected', async () => {
    const o = seedOrder({ token: 'tok-1' })
    iyzico = () => ({ status: 'success', paymentStatus: 'FAILURE', token: 'tok-other' })

    await GET(new Request('https://shop.test/api/payments/callback?token=tok-1'))

    expect(order(o.id).payment_status).toBe('pending')
  })

  it('paid-path injection with a paid token for another order is blocked', async () => {
    const victim = seedOrder({ token: 'tok-victim' })
    seedOrder({ token: 'tok-attacker' })
    iyzico = ({ token }) => ({
      status: 'success',
      paymentStatus: 'SUCCESS',
      token,
      paidPrice: '1000.0',
      currency: 'TRY',
      paymentId: 'pay-attacker',
    })

    await POST(formPost({ token: 'tok-attacker', conversationId: victim.id }))

    expect(order(victim.id).payment_status).toBe('pending')
  })
})

describe('M1: legitimate results still work', () => {
  it('genuine FAILURE cancels the order and releases its reservation', async () => {
    const o = seedOrder({ token: 'tok-1' })
    iyzico = ({ token }) => ({ status: 'success', paymentStatus: 'FAILURE', token, conversationId: o.id })

    const res = await POST(formPost({ token: 'tok-1' }))

    expect(location(res)).toContain('reason=payment_failed')
    expect(order(o.id)).toMatchObject({ status: 'cancelled', payment_status: 'failed' })
    expect(stock(o.sku).reserved_quantity).toBe(0)
  })

  it('genuine SUCCESS finalizes the order and redirects with an access token', async () => {
    const o = seedOrder({ token: 'tok-1', total: 1000 })
    iyzico = ({ token }) => ({
      status: 'success',
      paymentStatus: 'SUCCESS',
      token,
      conversationId: o.id,
      basketId: o.orderNumber,
      paidPrice: '1000.0',
      currency: 'TRY',
      paymentId: 'pay-1',
    })

    const res = await GET(new Request('https://shop.test/api/payments/callback?token=tok-1'))

    expect(location(res)).toMatch(new RegExp(`/checkout/success\\?orderId=${o.id}&t=[0-9a-f]{32}`))
    expect(order(o.id)).toMatchObject({ status: 'payment_received', payment_status: 'paid' })
    expect(stock(o.sku)).toMatchObject({ quantity: 4, reserved_quantity: 0 })
  })

  it('a repeated SUCCESS callback is idempotent', async () => {
    const o = seedOrder({ token: 'tok-1' })
    iyzico = ({ token }) => ({
      status: 'success',
      paymentStatus: 'SUCCESS',
      token,
      paidPrice: '1000.0',
      currency: 'TRY',
      paymentId: 'pay-1',
    })

    await GET(new Request('https://shop.test/api/payments/callback?token=tok-1'))
    await GET(new Request('https://shop.test/api/payments/callback?token=tok-1'))

    expect(stock(o.sku)).toMatchObject({ quantity: 4, reserved_quantity: 0 })
    expect(ctx.db.tables.inventory_ledger.filter((l) => l.reason === 'commit')).toHaveLength(1)
  })
})

describe('M1: webhook (unsigned) uses the same verification', () => {
  const hook = (body: unknown) =>
    WEBHOOK(new Request('https://shop.test/api/payments/webhook', { method: 'POST', body: JSON.stringify(body) }))

  it('rejects an unknown token without calling iyzico', async () => {
    const victim = seedOrder({ token: 'tok-victim' })
    const res = await hook({ token: 'garbage', conversationId: victim.id, paymentStatus: 'FAILURE' })

    expect(res.status).toBe(401)
    expect(order(victim.id).payment_status).toBe('pending')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores body status fields and uses the retrieved result', async () => {
    const o = seedOrder({ token: 'tok-1' })
    iyzico = ({ token }) => ({
      status: 'success',
      paymentStatus: 'SUCCESS',
      token,
      paidPrice: '1000.0',
      currency: 'TRY',
      paymentId: 'pay-1',
    })

    const res = await hook({ token: 'tok-1', paymentStatus: 'FAILURE' })

    expect(res.status).toBe(200)
    expect(order(o.id).payment_status).toBe('paid')
  })
})
