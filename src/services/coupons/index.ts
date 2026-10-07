import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const couponCodeSchema = z.string().trim().min(2).max(40)

export type CouponValidationResult =
  | { valid: true; discount: number; coupon: { id: string; code: string; type: string; value: number } }
  | { valid: false; error: string }

export async function validateCoupon(params: {
  code: string
  subtotal: number
  userId?: string | null
  guestEmail?: string | null
}): Promise<CouponValidationResult> {
  const code = couponCodeSchema.parse(params.code).toUpperCase()
  const supabase = getSupabaseAdmin()

  const { data: coupon } = await supabase
    .from('coupons')
    .select('*')
    .eq('code', code)
    .eq('is_active', true)
    .maybeSingle()

  // One generic message for unknown / inactive / not-started / expired codes so the
  // endpoint cannot be used to learn which codes exist.
  const GENERIC = 'Geçersiz veya kullanılamayan kupon kodu'
  if (!coupon) return { valid: false, error: GENERIC }

  const now = new Date()
  if (coupon.starts_at && new Date(coupon.starts_at) > now) {
    return { valid: false, error: GENERIC }
  }
  if (coupon.ends_at && new Date(coupon.ends_at) < now) {
    return { valid: false, error: GENERIC }
  }
  if (coupon.min_subtotal && params.subtotal < Number(coupon.min_subtotal)) {
    return { valid: false, error: `Minimum sepet tutarı ${coupon.min_subtotal} TL` }
  }

  // Unpaid orders that still hold the coupon (within the pending TTL) count as usage,
  // otherwise parallel checkouts could all pass the limit before any is paid.
  const pendingCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const countPending = async (scope?: { userId?: string | null; email?: string | null }) => {
    let q = supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('coupon_code', coupon.code)
      .eq('payment_status', 'pending')
      .gte('created_at', pendingCutoff)
    if (scope?.userId) q = q.eq('user_id', scope.userId)
    if (scope?.email) q = q.eq('guest_email', scope.email)
    const { count } = await q
    return count ?? 0
  }

  if (coupon.usage_limit != null) {
    const { count } = await supabase
      .from('coupon_usages')
      .select('*', { count: 'exact', head: true })
      .eq('coupon_id', coupon.id)
    if ((count ?? 0) + (await countPending()) >= coupon.usage_limit) {
      return { valid: false, error: 'Kupon kullanım limitine ulaşıldı' }
    }
  }

  if (coupon.per_user_limit != null) {
    const email = params.guestEmail?.trim().toLowerCase() || null
    if (params.userId) {
      const { count } = await supabase
        .from('coupon_usages')
        .select('*', { count: 'exact', head: true })
        .eq('coupon_id', coupon.id)
        .eq('user_id', params.userId)
      if ((count ?? 0) + (await countPending({ userId: params.userId })) >= coupon.per_user_limit) {
        return { valid: false, error: 'Bu kuponu daha önce kullandınız' }
      }
    } else if (email) {
      // Guests are limited per e-mail address
      const { count } = await supabase
        .from('coupon_usages')
        .select('*', { count: 'exact', head: true })
        .eq('coupon_id', coupon.id)
        .eq('guest_email', email)
      if ((count ?? 0) + (await countPending({ email })) >= coupon.per_user_limit) {
        return { valid: false, error: 'Bu kuponu daha önce kullandınız' }
      }
    }
  }

  let discount = 0
  if (coupon.type === 'percent') {
    discount = (params.subtotal * Number(coupon.value)) / 100
    if (coupon.max_discount != null) {
      discount = Math.min(discount, Number(coupon.max_discount))
    }
  } else {
    discount = Number(coupon.value)
  }

  discount = Math.min(discount, params.subtotal)
  discount = Math.round(discount * 100) / 100

  return {
    valid: true,
    discount,
    coupon: {
      id: coupon.id,
      code: coupon.code,
      type: coupon.type,
      value: Number(coupon.value),
    },
  }
}
