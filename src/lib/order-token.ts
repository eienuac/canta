import { createHmac, timingSafeEqual } from 'crypto'

function secret() {
  const s = process.env.PAYLOAD_SECRET
  if (!s) throw new Error('PAYLOAD_SECRET is required')
  return s
}

/**
 * Unguessable proof that the browser returned from the payment provider for this
 * order. Lets the success page show order details to guests without exposing
 * orders to anyone who merely knows/guesses an order id.
 */
export function signOrderAccess(orderId: string): string {
  return createHmac('sha256', secret()).update(`order-access:${orderId}`).digest('hex').slice(0, 32)
}

export function verifyOrderAccess(orderId: string, token?: string | null): boolean {
  if (!token) return false
  try {
    const expected = Buffer.from(signOrderAccess(orderId))
    const given = Buffer.from(token)
    return expected.length === given.length && timingSafeEqual(expected, given)
  } catch {
    return false
  }
}
