import { NextResponse } from 'next/server'
import { getPaymentProvider } from '@/services/payment'
import {
  finalizePaidOrder,
  markOrderPaymentFailed,
  processCheckoutFormToken,
  resolveOrderIdFromPaymentResult,
} from '@/services/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SIGNATURE_HEADERS = ['x-iyzico-signature', 'x-payment-signature']

export async function POST(request: Request) {
  const body = await request.text()
  const signed = SIGNATURE_HEADERS.some((h) => request.headers.get(h))

  // Unsigned notification: treat it purely as a trigger. Only the token is read, and the
  // result is re-verified with iyzico for the order that token was issued for.
  if (!signed) {
    let token: string | null = null
    try {
      const parsed = JSON.parse(body) as { token?: unknown }
      token = typeof parsed?.token === 'string' && parsed.token ? parsed.token : null
    } catch {
      token = null
    }
    if (!token) return NextResponse.json({ error: 'Invalid webhook' }, { status: 401 })

    try {
      const outcome = await processCheckoutFormToken(token)
      if (outcome.kind === 'unknown_token' || outcome.kind === 'unverified' || outcome.kind === 'mismatch') {
        return NextResponse.json({ error: 'Invalid webhook' }, { status: 401 })
      }
      return NextResponse.json({ ok: true, status: outcome.kind })
    } catch (e) {
      console.error('[payments/webhook] failed', e instanceof Error ? e.message : 'unknown')
      return NextResponse.json({ error: 'Finalize failed' }, { status: 500 })
    }
  }

  // Signed notification (HMAC branch, unchanged until the official iyzico format is verified).
  let verified: Awaited<ReturnType<ReturnType<typeof getPaymentProvider>['verifyWebhook']>>
  try {
    verified = await getPaymentProvider().verifyWebhook(request.headers, body)
  } catch (e) {
    console.error('[payments/webhook] verify failed', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'Invalid webhook' }, { status: 401 })
  }

  if (!verified.valid) {
    return NextResponse.json({ error: 'Invalid webhook' }, { status: 401 })
  }

  const orderId =
    verified.orderId ||
    (await resolveOrderIdFromPaymentResult({
      basketId: verified.basketId,
      token: verified.token,
      providerPaymentId: verified.providerPaymentId,
    }))
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid webhook' }, { status: 401 })
  }

  try {
    if (verified.status === 'paid') {
      const result = await finalizePaidOrder({
        orderId,
        token: verified.token,
        providerPaymentId: verified.providerPaymentId,
        amount: verified.amount,
        currency: verified.currency,
        raw: verified.raw,
      })
      return NextResponse.json(result)
    }

    if (verified.status === 'failed') {
      const result = await markOrderPaymentFailed({
        orderId,
        token: verified.token,
        providerPaymentId: verified.providerPaymentId,
        raw: verified.raw,
      })
      return NextResponse.json(result)
    }

    return NextResponse.json({ ok: true, ignored: true })
  } catch (e) {
    console.error('[payments/webhook] failed', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'Finalize failed' }, { status: 500 })
  }
}
