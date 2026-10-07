import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { releaseExpiredPendingOrders } from '@/services/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') || ''
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const released = await releaseExpiredPendingOrders(200)
  return NextResponse.json({ ok: true, released })
}
