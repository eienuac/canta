import { createHmac, timingSafeEqual } from 'crypto'

/** How long the success-page link keeps showing order details to a guest. */
export const ORDER_ACCESS_TTL_MS = 24 * 60 * 60 * 1000

function secret() {
  const s = process.env.PAYLOAD_SECRET
  if (!s) throw new Error('PAYLOAD_SECRET is required')
  return s
}

function mac(orderId: string, expiresAt: number) {
  return createHmac('sha256', secret())
    .update(`order-access:v2:${orderId}:${expiresAt}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Unguessable, short-lived proof that the browser returned from the payment provider for
 * this order. Lets the success page show order details to guests without exposing orders
 * to anyone who merely knows/guesses an order id. Format: `<expiresAtMs>.<hmac>`.
 */
export function signOrderAccess(orderId: string, now = Date.now()): string {
  const expiresAt = now + ORDER_ACCESS_TTL_MS
  return `${expiresAt}.${mac(orderId, expiresAt)}`
}

export function verifyOrderAccess(orderId: string, token?: string | null, now = Date.now()): boolean {
  if (!token) return false
  const match = /^(\d{13})\.([0-9a-f]{32})$/.exec(token)
  if (!match) return false
  const expiresAt = Number(match[1])
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false
  // Reject tokens claiming an expiry further out than we ever issue.
  if (expiresAt > now + ORDER_ACCESS_TTL_MS + 60_000) return false
  try {
    const expected = Buffer.from(mac(orderId, expiresAt))
    const given = Buffer.from(match[2])
    return expected.length === given.length && timingSafeEqual(expected, given)
  } catch {
    return false
  }
}
