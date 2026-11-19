import { NextResponse } from 'next/server'
import { verifyIyzicoWebhookSignature } from '@/services/payment/iyzico'
import { processCheckoutFormToken } from '@/services/orders'
import { rateLimit, requestIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SIGNATURE_HEADER = 'x-iyz-signature-v3'

/** Generous: iyzico may retry, but unauthenticated floods must not reach the provider API. */
const WEBHOOK_LIMIT_PER_MINUTE = 120

/**
 * Once iyzico has enabled X-IYZ-SIGNATURE-V3 for the merchant account, set
 * IYZICO_WEBHOOK_REQUIRE_SIGNATURE=true so unsigned notifications are refused outright.
 */
function signatureRequired() {
  return process.env.IYZICO_WEBHOOK_REQUIRE_SIGNATURE?.trim().toLowerCase() === 'true'
}

const invalid = () => NextResponse.json({ error: 'Invalid webhook' }, { status: 401 })
/** 2xx stops iyzico's retries for authentic notifications we have nothing to do with. */
const ignored = () => NextResponse.json({ ok: true, ignored: true })

/**
 * iyzico payment notification. Whether signed or not, the body is only a trigger: the order
 * is found from the token WE issued and the result is retrieved from iyzico before anything
 * changes (processCheckoutFormToken). The signature additionally proves the origin.
 */
export async function POST(request: Request) {
  if (!(await rateLimit(`payment-webhook:${requestIp(request)}`, WEBHOOK_LIMIT_PER_MINUTE, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let payload: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(await request.text())
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalid()
    payload = parsed as Record<string, unknown>
  } catch {
    return invalid()
  }

  const signature = request.headers.get(SIGNATURE_HEADER)
  const signed = Boolean(signature)
  if (signed && !verifyIyzicoWebhookSignature(payload, signature!)) {
    console.error('[payments/webhook] signature mismatch')
    return invalid()
  }
  if (!signed && signatureRequired()) return invalid()

  const token = typeof payload.token === 'string' && payload.token ? payload.token : null
  // Signed but without a token: a direct-API or subscription event this shop does not use.
  if (!token) return signed ? ignored() : invalid()

  try {
    const outcome = await processCheckoutFormToken(token)
    if (outcome.kind === 'unknown_token') return signed ? ignored() : invalid()
    if (outcome.kind === 'unverified' || outcome.kind === 'mismatch') return invalid()
    return NextResponse.json({ ok: true, status: outcome.kind })
  } catch (e) {
    console.error('[payments/webhook] failed', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'Finalize failed' }, { status: 500 })
  }
}
