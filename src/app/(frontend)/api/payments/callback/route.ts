import { NextResponse } from 'next/server'
import { getPaymentProvider } from '@/services/payment'
import {
  finalizePaidOrder,
  markOrderPaymentFailed,
  resolveOrderIdFromPaymentResult,
} from '@/services/orders'
import { absoluteUrl } from '@/lib/utils'
import { getErrorMessage } from '@/lib/errors'
import { signOrderAccess } from '@/lib/order-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Verified = {
  valid: boolean
  status?: 'paid' | 'failed' | 'pending'
  orderId?: string
  basketId?: string
  token?: string
  providerPaymentId?: string
  amount?: number
  currency?: string
  raw?: unknown
}

async function parseCallbackBody(request: Request): Promise<{
  body: string
  token: string | null
}> {
  const contentType = request.headers.get('content-type') || ''
  const fields: Record<string, string> = {}

  if (contentType.includes('application/json')) {
    const text = await request.text()
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      for (const [k, v] of Object.entries(parsed)) {
        if (v != null) fields[k] = String(v)
      }
    } catch {
      // keep empty
    }
    return { body: text, token: fields.token || null }
  }

  try {
    const form = await request.formData()
    for (const [k, v] of form.entries()) {
      fields[k] = String(v)
    }
  } catch (err) {
    console.error('[payments/callback] formData parse failed', getErrorMessage(err))
  }

  const urlToken = new URL(request.url).searchParams.get('token')
  const token = fields.token || urlToken
  return { body: JSON.stringify({ ...fields, token }), token }
}

async function enrichOrderId(verified: Verified): Promise<Verified> {
  if (verified.orderId) return verified

  const raw = verified.raw as { basketId?: string; token?: string } | undefined
  const resolved = await resolveOrderIdFromPaymentResult({
    orderId: verified.orderId,
    basketId: verified.basketId || raw?.basketId,
    token: verified.token || raw?.token,
    providerPaymentId: verified.providerPaymentId,
  })

  return { ...verified, orderId: resolved || undefined }
}

async function handleVerified(verified: Verified, kind: string) {
  const enriched = await enrichOrderId(verified)

  console.info('[payments/callback] verified', {
    kind,
    valid: enriched.valid,
    status: enriched.status,
    orderId: enriched.orderId,
  })

  if (!enriched.valid) {
    console.error('[payments/callback] invalid verification', { kind })
    return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=invalid'))
  }

  if (!enriched.orderId) {
    console.error('[payments/callback] orderId unresolved', { kind, status: enriched.status })
    return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=order_not_found'))
  }

  if (enriched.status === 'failed') {
    try {
      await markOrderPaymentFailed({
        orderId: enriched.orderId,
        providerPaymentId: enriched.providerPaymentId,
        raw: enriched.raw,
      })
    } catch (err) {
      console.error('[payments/callback] markOrderPaymentFailed', getErrorMessage(err))
    }
    return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=payment_failed'))
  }

  if (enriched.status !== 'paid') {
    return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=pending'))
  }

  try {
    await finalizePaidOrder({
      orderId: enriched.orderId,
      token: enriched.token,
      providerPaymentId: enriched.providerPaymentId,
      amount: enriched.amount,
      currency: enriched.currency,
      raw: enriched.raw,
    })
    const access = signOrderAccess(enriched.orderId)
    return NextResponse.redirect(
      absoluteUrl(`/checkout/success?orderId=${enriched.orderId}&t=${access}`)
    )
  } catch (err) {
    console.error('[payments/callback] finalizePaidOrder failed', getErrorMessage(err))
    return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=finalize'))
  }
}

/**
 * iyzico Checkout Form return URL.
 * Browser POSTs `token`; we re-verify via CF retrieve (never trust alone).
 */
export async function POST(request: Request) {
  try {
    const { body, token } = await parseCallbackBody(request)

    if (!token) {
      return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=missing_token'))
    }

    const provider = getPaymentProvider()
    const verified = await provider.verifyWebhook(new Headers(), body)
    return handleVerified({ ...verified, token: verified.token || token }, 'callback')
  } catch (err) {
    console.error('[payments/callback] POST unhandled', getErrorMessage(err))
    return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=exception'))
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    if (!token) {
      return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=missing_token'))
    }

    const provider = getPaymentProvider()
    // Never forward the caller's headers: a forged signature header would switch the
    // provider into signed-webhook mode and skip the token retrieve.
    const verified = await provider.verifyWebhook(new Headers(), JSON.stringify({ token }))
    return handleVerified(
      {
        ...verified,
        providerPaymentId: verified.providerPaymentId || token,
        token: verified.token || token,
      },
      'callback-get'
    )
  } catch (err) {
    console.error('[payments/callback] GET unhandled', getErrorMessage(err))
    return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=exception'))
  }
}
