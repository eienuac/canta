import { NextResponse } from 'next/server'
import { getPaymentProvider } from '@/services/payment'
import {
  finalizePaidOrder,
  markOrderPaymentFailed,
  resolveOrderIdFromPaymentResult,
} from '@/services/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const body = await request.text()
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
