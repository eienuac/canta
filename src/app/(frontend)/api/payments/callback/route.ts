import { NextResponse } from 'next/server'
import { processCheckoutFormToken } from '@/services/orders'
import { absoluteUrl } from '@/lib/utils'
import { getErrorMessage } from '@/lib/errors'
import { signOrderAccess } from '@/lib/order-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Only the checkout-form token is read from the browser; every other field is ignored. */
async function readCallbackToken(request: Request): Promise<string | null> {
  const urlToken = new URL(request.url).searchParams.get('token')
  if (request.method !== 'POST') return urlToken

  const contentType = request.headers.get('content-type') || ''
  try {
    if (contentType.includes('application/json')) {
      const parsed = (await request.json()) as { token?: unknown }
      return typeof parsed?.token === 'string' && parsed.token ? parsed.token : urlToken
    }
    const form = await request.formData()
    const token = form.get('token')
    return typeof token === 'string' && token ? token : urlToken
  } catch (err) {
    console.error('[payments/callback] body parse failed', getErrorMessage(err))
    return urlToken
  }
}

async function handle(request: Request, kind: string) {
  try {
    const token = await readCallbackToken(request)
    if (!token) {
      return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=missing_token'))
    }

    const outcome = await processCheckoutFormToken(token)
    console.info('[payments/callback] outcome', { kind, outcome: outcome.kind })

    switch (outcome.kind) {
      case 'paid': {
        const access = signOrderAccess(outcome.orderId)
        return NextResponse.redirect(
          absoluteUrl(`/checkout/success?orderId=${outcome.orderId}&t=${access}`)
        )
      }
      case 'failed':
        return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=payment_failed'))
      case 'pending':
        return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=pending'))
      case 'unknown_token':
        return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=order_not_found'))
      default:
        return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=invalid'))
    }
  } catch (err) {
    console.error('[payments/callback] processing failed', { kind, error: getErrorMessage(err) })
    return NextResponse.redirect(absoluteUrl('/checkout/failure?reason=finalize'))
  }
}

/**
 * iyzico Checkout Form return URL.
 * Browser POSTs `token`; the result is always re-verified via CF retrieve.
 */
export async function POST(request: Request) {
  return handle(request, 'callback')
}

export async function GET(request: Request) {
  return handle(request, 'callback-get')
}
