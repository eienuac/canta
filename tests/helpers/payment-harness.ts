/**
 * Shared setup for payment route/service tests: in-memory Supabase, stubbed iyzico fetch
 * (no network), payment env vars and request helpers.
 *
 * Test files register the module mocks (vi.mock is hoisted per file):
 *   vi.mock('@/lib/supabase/admin', () => import('../helpers/mocks/supabase-admin'))
 *   vi.mock('@/lib/payload', () => import('../helpers/mocks/payload'))
 */
import { afterEach, beforeEach, vi } from 'vitest'
import { createFakeSupabase, type FakeDb } from './fake-supabase'

export type Body = Record<string, unknown>

export const harness = {
  db: null as unknown as FakeDb,
  /** iyzico reply for the parsed request body (initialize or CF retrieve). */
  iyzico: (() => ({})) as (body: Body) => Body,
}

export const fetchMock = vi.fn(async (_url: string, init: { body: string }) => ({
  ok: true,
  status: 200,
  json: async () => harness.iyzico(JSON.parse(init.body)),
}))

export function setupPaymentHarness() {
  beforeEach(() => {
    harness.db = createFakeSupabase()
    harness.iyzico = () => ({})
    vi.stubEnv('PAYMENT_PROVIDER', 'iyzico')
    vi.stubEnv('PAYMENT_API_KEY', 'test-api-key')
    vi.stubEnv('PAYMENT_SECRET_KEY', 'test-secret-key')
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
}

export const location = (res: Response) => res.headers.get('location') ?? ''

export const callbackGetRequest = (token: string) =>
  new Request(`https://shop.test/api/payments/callback?token=${encodeURIComponent(token)}`)

export const callbackPostRequest = (fields: Record<string, string>) =>
  new Request('https://shop.test/api/payments/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  })

export const webhookRequest = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://shop.test/api/payments/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

/** iyzico CF retrieve reply for a successful payment of `paidPrice`. */
export const iyzicoSuccess =
  (paidPrice: string, extra: Body = {}) =>
  (b: Body): Body => ({
    status: 'success',
    paymentStatus: 'SUCCESS',
    token: b.token,
    paidPrice,
    price: paidPrice,
    currency: 'TRY',
    paymentId: `pay-${String(b.token)}`,
    ...extra,
  })

/** iyzico CF retrieve reply for an explicitly failed payment. */
export const iyzicoFailure =
  (extra: Body = {}) =>
  (b: Body): Body => ({ status: 'success', paymentStatus: 'FAILURE', token: b.token, ...extra })
