import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { assertCartAccess, getCartWithProducts } from '@/services/cart'
import { validateCoupon } from '@/services/coupons'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import type { Database } from '@/types/database'
import type { User } from '@supabase/supabase-js'

async function resolveUser(request: Request): Promise<User | null> {
  const authHeader = request.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  if (bearer) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (url && anon) {
      const client = createSupabaseClient<Database>(url, anon, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { data } = await client.auth.getUser(bearer)
      if (data.user) return data.user
    }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function POST(request: Request) {
  try {
    // Tight limit: this endpoint is the only way to brute-force coupon codes.
    if (!(await rateLimit(`coupon:${await clientIp()}`, 10, 60_000))) {
      return NextResponse.json({ error: 'Çok fazla deneme. Lütfen biraz bekleyin.' }, { status: 429 })
    }

    const body = z
      .object({
        code: z.string().max(40),
        cartId: z.string().uuid(),
        guestToken: z.string().min(8).optional(),
      })
      .parse(await request.json())

    const user = await resolveUser(request)
    await assertCartAccess(body.cartId, user?.id, body.guestToken)

    const cart = await getCartWithProducts(body.cartId)
    const result = await validateCoupon({
      code: body.code,
      subtotal: cart.subtotal,
      userId: user?.id,
    })

    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    await admin.from('carts').update({ coupon_code: result.coupon.code }).eq('id', body.cartId)

    return NextResponse.json({ discount: result.discount, code: result.coupon.code })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Kupon uygulanamadı' },
      { status: 400 }
    )
  }
}
